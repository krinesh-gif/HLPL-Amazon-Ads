import { writeV3 } from "./client.js";

/** Sponsored Products product/auto target writes (v3). Deploy step only; not yet verified live. */
const CT = "application/vnd.spTargetingClause.v3+json";

export function updateTargets(updates: { targetId: string; bid?: number; state?: "ENABLED" | "PAUSED" }[]) {
  return writeV3("PUT", "/sp/targets", CT, "targetingClauses", updates, "targetId");
}

export function createAsinTargets(items: { campaignId: string; adGroupId: string; asin: string; bid: number }[]) {
  return writeV3("POST", "/sp/targets", CT, "targetingClauses",
    items.map((t) => ({
      campaignId: t.campaignId, adGroupId: t.adGroupId, bid: t.bid, state: "ENABLED", expressionType: "MANUAL",
      expression: [{ type: "ASIN_SAME_AS", value: t.asin.toUpperCase() }],
    })), "targetId");
}

export function archiveTargets(targetIds: string[]) {
  return writeV3("POST", "/sp/targets/delete", CT, "targetingClauses", { targetIdFilter: { include: targetIds } }, "targetId");
}
