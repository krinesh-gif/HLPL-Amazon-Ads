import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { existsSync } from "node:fs";
import {
  dataVersion,
  getCampaign,
  getCampaigns,
  getMeta,
  getOverview,
  getSyncStatus,
  type Range,
} from "./queries.js";

/**
 * Read-only dashboard server: a small JSON API over the local SQLite DB plus the
 * built web UI (dist/web). It never calls Amazon — data only arrives via `npm run sync:*`.
 *
 * There is no login yet, so it binds to 127.0.0.1 by default. Don't expose it on a
 * public interface (HOST=0.0.0.0) until auth is added — this is live business data.
 */

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const WEB_DIR = "./dist/web";

const app = new Hono();
app.use("*", compress());

// ---- Response cache: queries are pure functions of (URL, DB contents). ----
// PRAGMA data_version bumps whenever a sync job commits, which clears the cache.
const cache = new Map<string, string>();
let cachedVersion = -1;

app.use("/api/*", async (c, next) => {
  const version = dataVersion();
  if (version !== cachedVersion) {
    cache.clear();
    cachedVersion = version;
  }
  const key = c.req.url;
  const etag = `W/"${version}-${hash(key)}"`;
  c.header("Cache-Control", "private, no-cache");
  c.header("ETag", etag);
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304);

  const hit = cache.get(key);
  if (hit) return c.body(hit, 200, { "Content-Type": "application/json" });
  await next();
  if (c.res.status === 200 && cache.size < 500) cache.set(key, await c.res.clone().text());
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 731;

function parseRange(from?: string, to?: string): Range | string {
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return "from/to must be YYYY-MM-DD";
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (Number.isNaN(days) || days < 0) return "from must be on or before to";
  if (days > MAX_RANGE_DAYS) return `range may not exceed ${MAX_RANGE_DAYS} days`;
  return { from, to };
}

app.get("/api/meta", (c) => c.json(getMeta()));
app.get("/api/sync", (c) => c.json(getSyncStatus()));

app.get("/api/overview", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  return typeof range === "string" ? c.json({ error: range }, 400) : c.json(getOverview(range));
});

app.get("/api/campaigns", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  return typeof range === "string" ? c.json({ error: range }, 400) : c.json(getCampaigns(range));
});

app.get("/api/campaigns/:id", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  if (typeof range === "string") return c.json({ error: range }, 400);
  const result = getCampaign(c.req.param("id"), range);
  return result ? c.json(result) : c.json({ error: "campaign not found" }, 404);
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// ---- Built web UI ----
if (existsSync(WEB_DIR)) {
  // Vite fingerprints everything under /assets, so it can be cached forever.
  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("/*", serveStatic({ root: WEB_DIR }));
  app.get("*", serveStatic({ path: `${WEB_DIR}/index.html` }));
} else {
  app.get("/", (c) =>
    c.text("Web UI not built yet. Run `npm run build:web` (or `npm run dev` for development).")
  );
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`Aravi Ads dashboard API on http://${HOST}:${info.port}`);
});
