import { listAllV3 } from "./client.js";

/**
 * Sponsored Products targeting clauses: product/ASIN and category targets (manual)
 * and the four auto-targeting groups (close-match, loose-match, substitutes, complements).
 */
export interface SpTarget {
  targetId: string;
  campaignId: string;
  adGroupId: string;
  expressionType: "AUTO" | "MANUAL";
  expression: { type: string; value?: string }[];
  resolvedExpression?: { type: string; value?: string }[];
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  bid?: number;
}

const CONTENT_TYPE = "application/vnd.spTargetingClause.v3+json";

export async function listSpTargets(): Promise<SpTarget[]> {
  return listAllV3<SpTarget>("/sp/targets/list", CONTENT_TYPE, "targetingClauses", {
    stateFilter: { include: ["ENABLED", "PAUSED"] },
  });
}

/** Human-readable form of a targeting expression, e.g. `asin="B0ABC"` or `close-match`. */
export function describeExpression(expr: SpTarget["expression"]): string {
  return expr
    .map((e) => {
      const type = e.type.toLowerCase();
      if (type === "queryhighrelmatches") return "close-match";
      if (type === "querybroadrelmatches") return "loose-match";
      if (type === "asinsubstituterelated") return "substitutes";
      if (type === "asinaccessoryrelated") return "complements";
      if (type === "asinsameas") return `asin="${e.value}"`;
      if (type === "asincategorysameas") return `category="${e.value}"`;
      if (type === "asinbrandsameas") return `brand="${e.value}"`;
      return e.value ? `${e.type}="${e.value}"` : e.type;
    })
    .join(" ");
}
