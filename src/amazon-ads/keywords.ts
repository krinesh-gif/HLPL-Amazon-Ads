import { listAllV3 } from "./client.js";

/** Sponsored Products keywords (manual keyword targeting) with their current bids. */
export interface SpKeyword {
  keywordId: string;
  campaignId: string;
  adGroupId: string;
  keywordText: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  bid?: number; // absent = uses the ad group's default bid
}

const CONTENT_TYPE = "application/vnd.spKeyword.v3+json";

export async function listSpKeywords(): Promise<SpKeyword[]> {
  return listAllV3<SpKeyword>("/sp/keywords/list", CONTENT_TYPE, "keywords", {
    stateFilter: { include: ["ENABLED", "PAUSED"] },
  });
}
