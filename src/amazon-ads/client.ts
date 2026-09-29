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
