import { listAllV3 } from "./client.js";

/** Sponsored Products ad groups — needed for names and the default bid auto targets fall back to. */
export interface SpAdGroup {
  adGroupId: string;
  campaignId: string;
  name: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  defaultBid: number;
}

const CONTENT_TYPE = "application/vnd.spAdGroup.v3+json";

export async function listSpAdGroups(): Promise<SpAdGroup[]> {
  return listAllV3<SpAdGroup>("/sp/adGroups/list", CONTENT_TYPE, "adGroups", {
    stateFilter: { include: ["ENABLED", "PAUSED"] },
  });
}
