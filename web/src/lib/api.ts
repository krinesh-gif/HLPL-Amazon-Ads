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
