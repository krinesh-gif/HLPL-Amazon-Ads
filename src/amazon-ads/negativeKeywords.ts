import { listAllV3 } from "./client.js";

/**
 * Negative keywords at ad-group and campaign level. Read so the dashboard doesn't
 * recommend negating a search term that's already negated.
 */
export interface SpNegativeKeyword {
  keywordId: string;
  campaignId: string;
  adGroupId?: string; // absent for campaign-level negatives
  keywordText: string;
  matchType: "NEGATIVE_EXACT" | "NEGATIVE_PHRASE" | "NEGATIVE_ASIN";
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
}

export async function listSpNegativeKeywords(): Promise<SpNegativeKeyword[]> {
  return listAllV3<SpNegativeKeyword>(
    "/sp/negativeKeywords/list",
    "application/vnd.spNegativeKeyword.v3+json",
    "negativeKeywords",
    { stateFilter: { include: ["ENABLED"] } }
  );
}

export async function listSpCampaignNegativeKeywords(): Promise<SpNegativeKeyword[]> {
  const rows = await listAllV3<SpNegativeKeyword>(
    "/sp/campaignNegativeKeywords/list",
    "application/vnd.spCampaignNegativeKeyword.v3+json",
    "campaignNegativeKeywords",
    { stateFilter: { include: ["ENABLED"] } }
  );
  return rows.map((r) => ({ ...r, adGroupId: undefined }));
}

/** Ad-group negative product targets (negated ASINs). Returned in the same shape, text = the ASIN. */
export async function listSpNegativeAsinTargets(): Promise<SpNegativeKeyword[]> {
  const rows = await listAllV3<{ targetId: string; campaignId: string; adGroupId: string; state: string; expression: { type: string; value?: string }[] }>(
    "/sp/negativeTargets/list",
    "application/vnd.spNegativeTargetingClause.v3+json",
    "negativeTargetingClauses",
    { stateFilter: { include: ["ENABLED"] } }
  );
  return rows
    .map((r) => ({ r, asin: r.expression.find((e) => e.type === "ASIN_SAME_AS")?.value }))
    .filter((x) => x.asin)
    .map(({ r, asin }) => ({
      keywordId: r.targetId, campaignId: r.campaignId, adGroupId: r.adGroupId,
      keywordText: asin!, matchType: "NEGATIVE_ASIN" as const, state: "ENABLED" as const,
    }));
}
