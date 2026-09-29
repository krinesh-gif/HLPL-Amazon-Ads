import { listAllV3 } from "./client.js";

/**
 * Sponsored Products campaigns, via the v3 "list" endpoints.
 * Amazon's v3 APIs use a POST + custom content-type instead of a plain GET —
 * this is the current pattern (2024+) replacing the older v2 GET /v2/sp/campaigns.
 * SB and SD have their own, slightly different endpoints/content-types; add
 * sbCampaigns.ts / sdCampaigns.ts alongside this one following the same shape.
 *
 * Note the v3 shape differs from v2: enums are UPPERCASE and the daily budget is
 * nested under `budget`. Sync code lower-cases enums before storing.
 */

export interface SpCampaign {
  campaignId: string;
  name: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  targetingType: "MANUAL" | "AUTO";
  budget: { budget: number; budgetType: "DAILY" };
  startDate: string;
  endDate?: string;
}

const CONTENT_TYPE = "application/vnd.spCampaign.v3+json";

export async function listSpCampaigns(): Promise<SpCampaign[]> {
  return listAllV3<SpCampaign>("/sp/campaigns/list", CONTENT_TYPE, "campaigns", { maxResults: 100 });
}
