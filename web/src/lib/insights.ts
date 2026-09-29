import type { CampaignRow } from "./types";
import { fmtINR, fmtPct } from "./format";

/**
 * Read-only recommendations computed from the synced data — the dashboard's
 * version of Nola's optimisation hints. They only *suggest*; nothing is sent to
 * Amazon. (Acting on them from here would need the staged "ready to deploy"
 * flow described in CLAUDE.md, which isn't built yet by design.)
 */

export type Severity = "critical" | "serious" | "warning" | "good";

export interface Insight {
  id: string;
  severity: Severity;
  kind: string;
  campaign: CampaignRow;
  title: string;
  detail: string;
  /** Rupees at stake — used for ordering. */
  impact: number;
}

const acos = (c: { cost: number; sales: number }) => (c.sales > 0 ? c.cost / c.sales : null);

export function computeInsights(rows: CampaignRow[], targetAcos: number): Insight[] {
  const out: Insight[] = [];
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const minSpend = Math.max(300, totalCost * 0.005); // ignore noise-level campaigns

  for (const c of rows) {
    const a = acos(c);
    const cpc = c.clicks > 0 ? c.cost / c.clicks : 0;

    if (c.cost >= minSpend && c.orders === 0) {
      out.push({
        id: `nosales-${c.campaignId}`, severity: "critical", kind: "Spend without sales", campaign: c, impact: c.cost,
        title: `${fmtINR(c.cost)} spent, zero orders`,
        detail: `${c.clicks} clicks at ${fmtINR(cpc, false, 2)} CPC and no attributed sales. Review search terms and consider pausing or lowering bids.`,
      });
      continue;
    }
    if (a != null && a > targetAcos * 1.5 && c.cost >= minSpend) {
      const excess = c.cost - c.sales * targetAcos;
      out.push({
        id: `acos-${c.campaignId}`, severity: "serious", kind: "ACOS above target", campaign: c, impact: excess,
        title: `ACOS ${fmtPct(a)} vs ${fmtPct(targetAcos, 0)} target`,
        detail: `About ${fmtINR(excess)} more spend than your target allows for these sales. Consider lowering bids on the weakest targets.`,
      });
    }
    if (c.activeDays >= 5 && c.budgetCappedDays / c.activeDays >= 0.3 && a != null && a <= targetAcos) {
      out.push({
        id: `budget-${c.campaignId}`, severity: "warning", kind: "Budget-capped", campaign: c, impact: c.sales * 0.2,
        title: `Hit its budget on ${c.budgetCappedDays} of ${c.activeDays} days`,
        detail: `Profitable at ${fmtPct(a)} ACOS but running out of its ${fmtINR(c.dailyBudget)} daily budget — likely missing sales. Consider raising the budget.`,
      });
    }
    if (a != null && a <= targetAcos * 0.6 && c.orders >= 10 && c.budgetCappedDays / Math.max(1, c.activeDays) < 0.3) {
      out.push({
        id: `scale-${c.campaignId}`, severity: "good", kind: "Room to scale", campaign: c, impact: c.sales * 0.1,
        title: `Efficient at ${fmtPct(a)} ACOS`,
        detail: `Well under target with budget to spare. Raising bids on top targets could win more traffic.`,
      });
    }
    if (c.prevCost > minSpend && c.cost > c.prevCost * 1.5 && c.sales < c.prevSales * 1.2) {
      out.push({
        id: `spike-${c.campaignId}`, severity: "warning", kind: "Spend spike", campaign: c, impact: c.cost - c.prevCost,
        title: `Spend up ${Math.round((c.cost / c.prevCost - 1) * 100)}%, sales didn't follow`,
        detail: `${fmtINR(c.prevCost)} → ${fmtINR(c.cost)} vs previous period while sales went ${fmtINR(c.prevSales)} → ${fmtINR(c.sales)}.`,
      });
    }
  }
  const rank: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, good: 3 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || y.impact - x.impact);
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  serious: "High",
  warning: "Watch",
  good: "Opportunity",
};
