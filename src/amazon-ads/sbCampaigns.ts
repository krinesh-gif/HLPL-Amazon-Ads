import { listAllV3 } from "./client.js";

/**
 * Sponsored Brands campaigns via the v4 list endpoint (same POST + vendor content-type
 * + nextToken shape as the SP v3 lists). Budgets can be daily or lifetime.
 * Only available on accounts enrolled in Brand Registry; others get a 401/403.
 */
export interface SbCampaign {
  campaignId: string;
  name: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  budget: number;
  budgetType: "DAILY" | "LIFETIME";
  startDate?: string;
  endDate?: string;
  costType?: string; // CPC | VCPM
}

const CONTENT_TYPE = "application/vnd.sbcampaignresource.v4+json";

export async function listSbCampaigns(): Promise<SbCampaign[]> {
  return listAllV3<SbCampaign>("/sb/v4/campaigns/list", CONTENT_TYPE, "campaigns", { maxResults: 100 });
}
