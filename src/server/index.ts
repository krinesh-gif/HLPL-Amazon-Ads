import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { compress } from "hono/compress";
import { existsSync } from "node:fs";
import {
  dataVersion,
  getCampaign,
  getCampaigns,
  getMeta,
  getOverview,
  getSyncStatus,
  type AdProduct,
  type Range,
} from "./queries.js";
import { currentUser, hasUsers, login, logout, requireSameOrigin, requireUser, type User } from "./auth.js";
import { discardChange, listDeploys, listStaged, stageChange, stageRevert, StageError, suggestedHarvestBid, LIMITS, type StageRequest } from "./changes.js";
import { deployMode, DeployError, runDeploy } from "./deploy.js";
import { db } from "../db/client.js";
import { commitImport, deleteImport, FIELDS, importHistory, previewImport, templateFor, type ImportRequest, type ImportType } from "./imports.js";
import { getProducts, saveProduct, setFeePct, type ProductInput } from "./products.js";
import { getSbMapper, setMapping } from "./sbMapper.js";
import { getSearchTerms } from "./searchTerms.js";
import { getTargets } from "./targets.js";

/**
 * Dashboard server: JSON API over the local SQLite DB plus the built web UI (dist/web).
 * Reads never call Amazon — data arrives via `npm run sync:*`. The only path that can
 * write to Amazon is POST /api/deploys, and only for changes already staged in the queue
 * (see changes.ts / deploy.ts).
 *
 * Every /api route except login requires a session. It still binds to 127.0.0.1 by default:
 * put it behind HTTPS before exposing it (HOST=0.0.0.0) — this is live business data.
 */

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const WEB_DIR = "./dist/web";

const app = new Hono<{ Variables: { user: User } }>();
app.use("*", compress());
app.use("/api/*", requireSameOrigin);

// ---- Login (the only unauthenticated API routes) ----
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);
app.get("/api/auth/me", (c) => {
  const user = currentUser(c);
  if (user) return c.json({ user });
  // On the demo database only, the sign-in screen may show the demo login.
  const demo = db.prepare(`SELECT value FROM meta WHERE key = 'data_source'`).pluck().get() === "demo";
  return c.json({ user: null, hasUsers: hasUsers(), demoLogin: demo ? { username: "demo", password: "aravi-demo" } : null });
});
app.use("/api/*", requireUser);

// ---- Response cache for the read-only data endpoints ----
// Keyed by URL. Cleared when a sync job commits (PRAGMA data_version bumps for other
// connections) and whenever this server itself changes data (staging / deploys).
const CACHEABLE = ["/api/meta", "/api/sync", "/api/overview", "/api/campaigns", "/api/targets", "/api/search-terms", "/api/products", "/api/sb-mapper"];
const cache = new Map<string, string>();
let cachedVersion = -1;
let localWrites = 0;

app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET") {
    await next();
    localWrites++;
    cache.clear();
    return;
  }
  if (!CACHEABLE.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
    c.header("Cache-Control", "no-store");
    return next();
  }
  const version = dataVersion() * 1_000_000 + localWrites;
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

/** ?ad=sp|sb|sd filters to one ad type; anything else (or absent) means all. */
function parseAd(v: string | undefined): AdProduct | null {
  return v === "sp" || v === "sb" || v === "sd" ? v : null;
}

app.get("/api/meta", (c) => c.json(getMeta()));
app.get("/api/sync", (c) => c.json(getSyncStatus()));

app.get("/api/overview", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  return typeof range === "string" ? c.json({ error: range }, 400) : c.json(getOverview(range, parseAd(c.req.query("ad"))));
});

app.get("/api/campaigns", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  return typeof range === "string" ? c.json({ error: range }, 400) : c.json(getCampaigns(range, parseAd(c.req.query("ad"))));
});

app.get("/api/campaigns/:id", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  if (typeof range === "string") return c.json({ error: range }, 400);
  const result = getCampaign(c.req.param("id"), range, parseAd(c.req.query("ad")));
  return result ? c.json(result) : c.json({ error: "campaign not found" }, 404);
});

export function numParam(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, n)) : fallback;
}

app.get("/api/search-terms", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  if (typeof range === "string") return c.json({ error: range }, 400);
  const view = c.req.query("view");
  return c.json(
    getSearchTerms({
      range,
      view: view === "harvest" || view === "negate" ? view : "all",
      campaignId: c.req.query("campaignId") || undefined,
      q: c.req.query("q") || undefined,
      targetAcos: numParam(c.req.query("targetAcos"), 0.3, 0.01, 5),
      minClicks: numParam(c.req.query("minClicks"), 10, 1, 1000),
      minOrders: numParam(c.req.query("minOrders"), 2, 1, 1000),
      sort: c.req.query("sort") || "cost",
      dir: c.req.query("dir") === "asc" ? "asc" : "desc",
      limit: numParam(c.req.query("limit"), 100, 1, 1000),
      offset: numParam(c.req.query("offset"), 0, 0, 1e7),
    })
  );
});

app.get("/api/targets", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  if (typeof range === "string") return c.json({ error: range }, 400);
  return c.json(getTargets(range, numParam(c.req.query("targetAcos"), 0.3, 0.01, 5), c.req.query("campaignId") || undefined));
});

// ---- Staging queue + deploys ----
app.get("/api/changes", (c) => c.json({ ...listStaged(), mode: deployMode() }));

app.post("/api/changes", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { changes?: StageRequest[] } | StageRequest | null;
  const list = body && "changes" in body && Array.isArray(body.changes) ? body.changes : body ? [body as StageRequest] : [];
  if (!list.length) return c.json({ error: "No changes given" }, 400);
  if (list.length > LIMITS.maxPerDeploy) return c.json({ error: `At most ${LIMITS.maxPerDeploy} at once` }, 400);
  const user = c.get("user").username;
  const staged: number[] = [];
  const errors: { index: number; error: string }[] = [];
  // Each item is validated on its own: one bad row doesn't block the rest.
  list.forEach((req, index) => {
    try {
      staged.push(stageChange(req, user));
    } catch (e) {
      if (!(e instanceof StageError)) throw e;
      errors.push({ index, error: e.message });
    }
  });
  return c.json({ staged, errors }, staged.length ? 200 : 400);
});

app.delete("/api/changes/:id", (c) =>
  discardChange(Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Not a staged change" }, 404)
);

app.post("/api/changes/:id/revert", (c) => {
  try {
    return c.json({ staged: [stageRevert(Number(c.req.param("id")), c.get("user").username)] });
  } catch (e) {
    if (e instanceof StageError) return c.json({ error: e.message }, 400);
    throw e;
  }
});

app.get("/api/deploys", (c) => c.json({ deploys: listDeploys(numParam(c.req.query("limit"), 20, 1, 100)) }));

app.post("/api/deploys", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: number[]; acknowledgeLive?: boolean; expectedMode?: string };
  try {
    return c.json(await runDeploy(body.ids ?? [], c.get("user").username, body));
  } catch (e) {
    if (e instanceof DeployError) return c.json({ error: e.message }, 400);
    throw e;
  }
});

/** SP manual-targeting ad groups — destinations for harvested search terms. */
const harvestAdGroups = db.prepare(`
  SELECT g.ad_group_id AS adGroupId, g.campaign_id AS campaignId, g.name AS adGroupName, c.name AS campaignName,
         (SELECT COUNT(*) FROM sp_targets t WHERE t.ad_group_id = g.ad_group_id AND t.kind = 'keyword' AND t.match_type = 'exact') AS exactKeywords,
         (SELECT COUNT(*) FROM sp_targets t WHERE t.ad_group_id = g.ad_group_id AND t.kind = 'product') AS productTargets
  FROM sp_ad_groups g JOIN sp_campaigns c ON c.campaign_id = g.campaign_id
  WHERE c.targeting_type = 'manual' AND c.state = 'enabled' AND g.state = 'enabled'
  ORDER BY c.name, g.name`);
app.get("/api/harvest-options", (c) => {
  const term = c.req.query("term") ?? "";
  return c.json({ adGroups: harvestAdGroups.all(), suggestedBid: term ? suggestedHarvestBid(term) : null, limits: LIMITS });
});

// ---- Setup: product catalogue, SB campaign mapper, data import (local data only) ----
const userError = (c: Context, e: unknown) => c.json({ error: e instanceof Error ? e.message : String(e) }, 400);

app.get("/api/products", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  return typeof range === "string" ? c.json({ error: range }, 400) : c.json(getProducts(range));
});
app.post("/api/products", async (c) => {
  try { saveProduct((await c.req.json()) as ProductInput, "create"); return c.json({ ok: true }); } catch (e) { return userError(c, e); }
});
app.put("/api/products/:asin", async (c) => {
  try { saveProduct({ ...((await c.req.json()) as ProductInput), asin: c.req.param("asin") }, "update"); return c.json({ ok: true }); }
  catch (e) { return userError(c, e); }
});
app.post("/api/settings/fees", async (c) => {
  try { setFeePct(Number(((await c.req.json()) as { feePct?: number }).feePct)); return c.json({ ok: true }); } catch (e) { return userError(c, e); }
});

app.get("/api/sb-mapper", (c) => {
  const range = parseRange(c.req.query("from"), c.req.query("to"));
  return typeof range === "string" ? c.json({ error: range }, 400) : c.json(getSbMapper(range));
});
app.put("/api/sb-mapper/:campaignId", async (c) => {
  try {
    const body = (await c.req.json()) as { products?: { asin: string; weight?: number }[] };
    setMapping(c.req.param("campaignId"), body.products ?? [], c.get("user").username);
    return c.json({ ok: true });
  } catch (e) { return userError(c, e); }
});

app.get("/api/imports", (c) => c.json({ history: importHistory(), fields: FIELDS }));
app.get("/api/imports/template/:type", (c) => {
  const type = c.req.param("type") as ImportType;
  if (!FIELDS[type]) return c.json({ error: "Unknown type" }, 404);
  return c.body("\uFEFF" + templateFor(type), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="aravi-${type}-template.csv"`,
  });
});
app.post("/api/imports/preview", async (c) => {
  try { return c.json(previewImport((await c.req.json()) as ImportRequest)); } catch (e) { return userError(c, e); }
});
app.post("/api/imports", async (c) => {
  try { return c.json(commitImport((await c.req.json()) as ImportRequest, c.get("user").username)); } catch (e) { return userError(c, e); }
});
app.delete("/api/imports/:id", (c) => {
  try { deleteImport(Number(c.req.param("id"))); return c.json({ ok: true }); } catch (e) { return userError(c, e); }
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
