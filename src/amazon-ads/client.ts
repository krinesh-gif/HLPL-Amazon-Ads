import { env } from "../config/env.js";
import { getAccessToken } from "./auth.js";

/**
 * Thin wrapper around fetch that attaches the headers every Amazon Ads API
 * call needs. Keep all raw HTTP in this one file — everything else in
 * src/amazon-ads/*.ts should call adsApiFetch() rather than using fetch directly.
 */
export async function adsApiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; needsProfile?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, headers = {}, needsProfile = true } = options;
  const accessToken = await getAccessToken();

  if (needsProfile && !env.profileId) {
    throw new Error(
      "AMAZON_ADS_PROFILE_ID is not set. Run `npm run sync:profiles` first to list the " +
        "available profile IDs for this account, then put the right one in .env."
    );
  }

  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": env.clientId,
      ...(needsProfile ? { "Amazon-Advertising-API-Scope": env.profileId } : {}),
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`Amazon Ads API ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  // 202/204 responses (e.g. report requests) may have no body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Pages through a v3 "list" endpoint (POST + vendor content-type, `nextToken` cursor)
 * and returns every item under `key`. All the SP v3 list calls share this shape.
 */
export async function listAllV3<T>(
  path: string,
  contentType: string,
  key: string,
  body: Record<string, unknown> = {}
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;
  do {
    const page = await adsApiFetch<Record<string, unknown> & { nextToken?: string }>(path, {
      method: "POST",
      body: { maxResults: 1000, ...body, ...(nextToken ? { nextToken } : {}) },
      headers: { "Content-Type": contentType, Accept: contentType },
    });
    items.push(...((page[key] as T[] | undefined) ?? []));
    nextToken = page.nextToken || undefined;
  } while (nextToken);
  return items;
}

/** Result of a v3 bulk write: which request items succeeded (with the id Amazon assigned) and which failed. */
export interface V3WriteResult {
  success: { index: number; id: string }[];
  error: { index: number; message: string }[];
}

/**
 * Sends one v3 bulk write (create / update / delete) and normalises the multi-status
 * response `{ <key>: { success: [...], error: [...] } }`. Only called from deploys.
 */
export async function writeV3(
  method: "POST" | "PUT",
  path: string,
  contentType: string,
  key: string,
  items: Record<string, unknown>[] | Record<string, unknown>,
  idField: string
): Promise<V3WriteResult> {
  const res = await adsApiFetch<Record<string, { success?: Record<string, unknown>[]; error?: Record<string, unknown>[] }>>(path, {
    method,
    body: Array.isArray(items) ? { [key]: items } : items,
    headers: { "Content-Type": contentType, Accept: contentType, Prefer: "return=representation" },
  });
  const block = res?.[key] ?? {};
  return {
    success: (block.success ?? []).map((s) => ({ index: Number(s.index), id: String(s[idField] ?? "") })),
    error: (block.error ?? []).map((e) => ({
      index: Number(e.index),
      message: JSON.stringify((e.errors as unknown[] | undefined) ?? e).slice(0, 500),
    })),
  };
}
