import { writeV3 } from "./client.js";

/**
 * Ad-group-level negatives: negative exact keywords for text search terms, negative
 * product targets for ASIN search terms. Deploy step only; not yet verified live.
 */
const KW = "application/vnd.spNegativeKeyword.v3+json";
const PT = "application/vnd.spNegativeTargetingClause.v3+json";

export function createNegativeExact(items: { campaignId: string; adGroupId: string; keywordText: string }[]) {
  return writeV3("POST", "/sp/negativeKeywords", KW, "negativeKeywords",
    items.map((n) => ({ ...n, matchType: "NEGATIVE_EXACT", state: "ENABLED" })), "negativeKeywordId");
}

export function deleteNegativeKeywords(ids: string[]) {
  return writeV3("POST", "/sp/negativeKeywords/delete", KW, "negativeKeywords",
    { negativeKeywordIdFilter: { include: ids } }, "negativeKeywordId");
}

export function createNegativeAsins(items: { campaignId: string; adGroupId: string; asin: string }[]) {
  return writeV3("POST", "/sp/negativeTargets", PT, "negativeTargetingClauses",
    items.map((n) => ({
      campaignId: n.campaignId, adGroupId: n.adGroupId, state: "ENABLED",
      expression: [{ type: "ASIN_SAME_AS", value: n.asin.toUpperCase() }],
    })), "targetId");
}

export function deleteNegativeTargets(ids: string[]) {
  return writeV3("POST", "/sp/negativeTargets/delete", PT, "negativeTargetingClauses",
    { targetIdFilter: { include: ids } }, "targetId");
}
