import { adsApiFetch } from "./client.js";

/**
 * Sponsored Display campaigns. Unlike SP/SB, SD still uses the older REST shape:
 * a GET with startIndex/count paging, lower-case enums, dates as YYYYMMDD.
 * `tactic` T00020 = contextual (product/category) targeting, T00030 = audiences.
 */
export interface SdCampaign {
  campaignId: number;
  name: string;
  tactic: "T00020" | "T00030" | string;
  state: "enabled" | "paused" | "archived";
  budget: number;
  budgetType: "daily";
  startDate?: string; // YYYYMMDD
  endDate?: string;
  costType?: "cpc" | "vcpm";
}

const PAGE = 100;

export async function listSdCampaigns(): Promise<SdCampaign[]> {
  const all: SdCampaign[] = [];
  for (let startIndex = 0; ; startIndex += PAGE) {
    const page = await adsApiFetch<SdCampaign[]>(
      `/sd/campaigns?startIndex=${startIndex}&count=${PAGE}&stateFilter=enabled,paused,archived`
    );
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export const SD_TACTIC_LABEL: Record<string, string> = {
  T00020: "contextual",
  T00030: "audiences",
};
