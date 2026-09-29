import type { Totals } from "./types";
import { fmtCount, fmtINR, fmtPct, fmtRatio } from "./format";

/** Every metric the dashboard can show, derived from the five stored totals. */
export type MetricKey =
  | "cost" | "sales" | "acos" | "roas" | "orders"
  | "impressions" | "clicks" | "ctr" | "cpc" | "cvr";

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  /** true when a lower value is the good direction (colors the delta). */
  lowerIsBetter?: boolean;
  /** Spend is neither good nor bad on its own. */
  neutral?: boolean;
  value: (t: Totals) => number | null;
  format: (v: number | null, compact?: boolean) => string;
  help: string;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export const METRICS: Record<MetricKey, MetricDef> = {
  cost: { key: "cost", label: "Ad spend", short: "Spend", neutral: true, value: (t) => t.cost, format: (v, c) => fmtINR(v, c), help: "Total Sponsored Products spend" },
  sales: { key: "sales", label: "Ad sales", short: "Sales", value: (t) => t.sales, format: (v, c) => fmtINR(v, c), help: "Attributed sales (14-day window)" },
  acos: { key: "acos", label: "ACOS", short: "ACOS", lowerIsBetter: true, value: (t) => div(t.cost, t.sales), format: (v) => fmtPct(v), help: "Spend ÷ ad sales" },
  roas: { key: "roas", label: "ROAS", short: "ROAS", value: (t) => div(t.sales, t.cost), format: (v) => fmtRatio(v), help: "Ad sales ÷ spend" },
  orders: { key: "orders", label: "Orders", short: "Orders", value: (t) => t.orders, format: (v, c) => fmtCount(v, c), help: "Attributed purchases (14-day window)" },
  impressions: { key: "impressions", label: "Impressions", short: "Impr.", neutral: true, value: (t) => t.impressions, format: (v, c) => fmtCount(v, c), help: "Times an ad was shown" },
  clicks: { key: "clicks", label: "Clicks", short: "Clicks", value: (t) => t.clicks, format: (v, c) => fmtCount(v, c), help: "Ad clicks" },
  ctr: { key: "ctr", label: "CTR", short: "CTR", value: (t) => div(t.clicks, t.impressions), format: (v) => fmtPct(v, 2), help: "Clicks ÷ impressions" },
  cpc: { key: "cpc", label: "CPC", short: "CPC", lowerIsBetter: true, value: (t) => div(t.cost, t.clicks), format: (v) => fmtINR(v, false, 2), help: "Spend ÷ clicks" },
  cvr: { key: "cvr", label: "Conversion rate", short: "CVR", value: (t) => div(t.orders, t.clicks), format: (v) => fmtPct(v), help: "Orders ÷ clicks" },
};

export const KPI_ORDER: MetricKey[] = ["cost", "sales", "acos", "roas", "orders", "impressions", "clicks", "ctr", "cpc", "cvr"];

/** Relative change, or null when there's no meaningful baseline. */
export function change(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}
