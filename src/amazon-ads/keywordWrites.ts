import { writeV3 } from "./client.js";

/**
 * Sponsored Products keyword writes (v3). Called only by the deploy step, never directly
 * from a button. Endpoint shapes follow Amazon's v3 docs; not yet verified live.
 */
const CT = "application/vnd.spKeyword.v3+json";

export function updateKeywords(updates: { keywordId: string; bid?: number; state?: "ENABLED" | "PAUSED" }[]) {
  return writeV3("PUT", "/sp/keywords", CT, "keywords", updates, "keywordId");
}

export function createExactKeywords(items: { campaignId: string; adGroupId: string; keywordText: string; bid: number }[]) {
  return writeV3("POST", "/sp/keywords", CT, "keywords",
    items.map((k) => ({ ...k, matchType: "EXACT", state: "ENABLED" })), "keywordId");
}

/** Archives keywords (Amazon's "delete"; used to revert a harvest). */
export function archiveKeywords(keywordIds: string[]) {
  return writeV3("POST", "/sp/keywords/delete", CT, "keywords", { keywordIdFilter: { include: keywordIds } }, "keywordId");
}
