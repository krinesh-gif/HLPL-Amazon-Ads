import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db, initSchema } from "../db/client.js";

/**
 * Username + password login with server-side sessions.
 * - Passwords: scrypt with a per-user salt. Users are added from the CLI (`npm run user:add`).
 * - Sessions: random 32-byte token in an HttpOnly, SameSite=Strict cookie; only its sha256 is stored.
 * - Mutating requests must come from this origin (checked in requireSameOrigin).
 */

initSchema();

const COOKIE = "aravi_session";
const SESSION_DAYS = 7;
const SCRYPT_N = 16384;

export interface User {
  id: number;
  username: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n) });
  return timingSafeEqual(actual, expected);
}

// A hash to verify against when the username doesn't exist, so timing doesn't reveal valid usernames.
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const stmts = {
  userByName: db.prepare(`SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?`),
  userCount: db.prepare(`SELECT COUNT(*) FROM users`).pluck(),
  insertSession: db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`),
  sessionUser: db.prepare(`
    SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token_hash = ?`),
  purgeSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),
  upsertUser: db.prepare(`
    INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`),
};

export function upsertUser(username: string, password: string): void {
  stmts.upsertUser.run(username, hashPassword(password), new Date().toISOString());
}

export const hasUsers = () => (stmts.userCount.get() as number) > 0;

// ---- Brute-force protection: 10 failed attempts per IP per 15 minutes ----
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60_000;
function clientKey(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export async function login(c: Context) {
  const key = clientKey(c);
  const f = failures.get(key);
  if (f && f.until > Date.now() && f.count >= 10) {
    return c.json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const row = stmts.userByName.get(username) as { id: number; username: string; passwordHash: string } | undefined;
  const ok = verifyPassword(password, row?.passwordHash ?? DUMMY_HASH) && !!row;
  if (!ok) {
    const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + WINDOW_MS };
    cur.count++;
    failures.set(key, cur);
    return c.json({ error: "Wrong username or password." }, 401);
  }
  failures.delete(key);
  stmts.purgeSessions.run(new Date().toISOString());
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  stmts.insertSession.run(sha256(token), row.id, new Date().toISOString(), expires.toISOString());
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: c.req.url.startsWith("https://"),
    path: "/",
    expires,
  });
  return c.json({ user: { id: row.id, username: row.username } });
}

export function logout(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) stmts.deleteSession.run(sha256(token));
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export function currentUser(c: Context): User | null {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  return (stmts.sessionUser.get(sha256(token), new Date().toISOString()) as User | undefined) ?? null;
}

/** Every /api route except /api/auth/* requires a session. */
export async function requireUser(c: Context, next: Next) {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Not signed in", needsLogin: true, hasUsers: hasUsers() }, 401);
  c.set("user", user);
  await next();
}

/**
 * CSRF guard for anything that changes state: the request must be JSON and, when the
 * browser sends an Origin, it must be this server. (SameSite=Strict on the cookie is
 * the first line; this is the second.)
 */
export async function requireSameOrigin(c: Context, next: Next) {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (origin && host && new URL(origin).host !== host) return c.json({ error: "Cross-origin request refused" }, 403);
    if (!c.req.header("content-type")?.includes("application/json")) {
      return c.json({ error: "Expected application/json" }, 415);
    }
  }
  await next();
}
