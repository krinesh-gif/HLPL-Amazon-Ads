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
  matchType: "NEGATIVE_EXACT" | "NEGATIVE_PHRASE";
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
