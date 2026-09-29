import { adsApiFetch } from "./client.js";

/**
 * Sponsored Products campaigns, via the v3 "list" endpoints.
 * Amazon's v3 APIs use a POST + custom content-type instead of a plain GET —
 * this is the current pattern (2024+) replacing the older v2 GET /v2/sp/campaigns.
 * SB and SD have their own, slightly different endpoints/content-types; add
 * sbCampaigns.ts / sdCampaigns.ts alongside this one following the same shape
 * once this slice (SP only) is working end to end.
 */

export interface SpCampaign {
  campaignId: string;
  name: string;
  state: "enabled" | "paused" | "archived";
  targetingType: "manual" | "auto";
  dailyBudget: number;
  startDate: string;
  endDate?: string;
}

const CONTENT_TYPE = "application/vnd.spCampaign.v3+json";

export async function listSpCampaigns(): Promise<SpCampaign[]> {
  const result = await adsApiFetch<{ campaigns: SpCampaign[] }>("/sp/campaigns/list", {
    method: "POST",
    body: { maxResults: 100 }, // paginate via nextToken for accounts with >100 campaigns
    headers: {
      "Content-Type": CONTENT_TYPE,
      Accept: CONTENT_TYPE,
    },
  });
  return result.campaigns;
}
