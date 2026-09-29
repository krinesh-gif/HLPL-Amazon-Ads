import { useEffect, useSyncExternalStore } from "react";

/**
 * Tiny stale-while-revalidate fetch cache. Every screen reads through useApi(), so
 * switching tabs or date ranges you've already seen is instant, and hovering a row
 * can prefetch the next screen.
 */

interface Entry {
  data?: unknown;
  error?: string;
  promise?: Promise<void>;
  fetchedAt?: number;
}

/** Fired when any request comes back 401 (e.g. the session expired) — the app shows the login screen. */
export const UNAUTHORIZED = "aravi:unauthorized";

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const FRESH_MS = 60_000;

function load(url: string, force = false): Promise<void> {
  const entry = cache.get(url) ?? {};
  if (entry.promise) return entry.promise;
  if (!force && entry.fetchedAt && Date.now() - entry.fetchedAt < FRESH_MS) return Promise.resolve();

  const promise = fetch(url)
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      cache.set(url, { data: body, fetchedAt: Date.now() });
    })
    .catch((err: Error) => {
      cache.set(url, { ...cache.get(url), error: err.message, promise: undefined, fetchedAt: Date.now() });
    })
    .finally(notify);
  cache.set(url, { ...entry, promise });
  return promise;
}

export const prefetch = (url: string) => void load(url);

/** Drop everything cached — used by the Refresh button after a sync. */
export function invalidateAll(): void {
  for (const [url, entry] of cache) cache.set(url, { ...entry, fetchedAt: 0 });
  notify();
}

export function useApi<T>(url: string | null): { data?: T; error?: string; loading: boolean } {
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => (url ? cache.get(url) : undefined)
  );
  const stale = url ? cache.get(url)?.fetchedAt === 0 : false;
  useEffect(() => {
    if (url) void load(url);
  }, [url, stale]);

  const entry = url ? cache.get(url) : undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.data ? undefined : entry?.error,
    loading: !!entry?.promise || (!!url && !entry),
  };
}

export const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

/**
 * Sends a change (stage / discard / revert / deploy). Always JSON — the server refuses
 * anything else for state-changing requests. Clears the read cache afterwards.
 */
export async function send<T = unknown>(method: "POST" | "PUT" | "DELETE", url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED));
  invalidateAll();
  if (!res.ok && !(data && Array.isArray((data as { errors?: unknown }).errors))) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Forget everything (used on sign-out so the next user never sees cached data). */
export function clearCache(): void {
  cache.clear();
  notify();
}
