import { db } from "../db/client.js";
import type { Range } from "./queries.js";

/**
 * Keywords & targets with performance and a suggested bid.
 * The suggestion nudges the bid toward the target ACOS, at most ±30% per step (the
 * same cautious stepping Nola's bid rules use). It is a number on screen only —
 * this dashboard never changes bids.
 */

const MIN_CLICKS = 10;
const MAX_STEP = 0.3;
const MIN_BID_INR = 1;

export interface TargetRow {
  targetId: string;
  kind: string | null;
  text: string;
  matchType: string | null;
  state: string | null;
  campaignId: string;
  campaignName: string | null;
  adGroupId: string;
  adGroupName: string | null;
  bid: number | null;
  bidIsDefault: boolean;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  suggestedBid: number | null;
  suggestion: string;
}

const stmt = db.prepare(`
  WITH perf AS (
    SELECT target_id, MAX(campaign_id) AS campaign_id, MAX(ad_group_id) AS ad_group_id,
           MAX(text) AS text, MAX(match_type) AS match_type,
           SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(cost) AS cost,
           SUM(sales_14d) AS sales, SUM(purchases_14d) AS orders
    FROM sp_target_daily_metrics
    WHERE date BETWEEN @from AND @to AND (@campaignId IS NULL OR campaign_id = @campaignId)
    GROUP BY target_id
  ),
  ids AS (
    SELECT target_id FROM perf
    UNION SELECT target_id FROM sp_targets
      WHERE state = 'enabled' AND (@campaignId IS NULL OR campaign_id = @campaignId)
  )
  SELECT ids.target_id AS targetId,
         t.kind AS kind,
         COALESCE(t.text, p.text, ids.target_id) AS text,
         COALESCE(t.match_type, p.match_type) AS matchType,
         t.state AS state,
         COALESCE(t.campaign_id, p.campaign_id) AS campaignId,
         c.name AS campaignName,
         COALESCE(t.ad_group_id, p.ad_group_id) AS adGroupId,
         g.name AS adGroupName,
         COALESCE(t.bid, g.default_bid) AS bid,
         (t.bid IS NULL AND g.default_bid IS NOT NULL) AS bidIsDefault,
         COALESCE(p.impressions, 0) AS impressions, COALESCE(p.clicks, 0) AS clicks,
         COALESCE(p.cost, 0) AS cost, COALESCE(p.sales, 0) AS sales, COALESCE(p.orders, 0) AS orders
  FROM ids
  LEFT JOIN perf p         ON p.target_id = ids.target_id
  LEFT JOIN sp_targets t   ON t.target_id = ids.target_id
  LEFT JOIN sp_campaigns c ON c.campaign_id = COALESCE(t.campaign_id, p.campaign_id)
  LEFT JOIN sp_ad_groups g ON g.ad_group_id = COALESCE(t.ad_group_id, p.ad_group_id)
  ORDER BY cost DESC`);

/** Report rows for targets that aren't in sp_targets (e.g. archived) get a kind from the match type. */
function inferKind(r: TargetRow): string {
  if (r.kind) return r.kind;
  if (r.matchType && ["exact", "phrase", "broad"].includes(r.matchType)) return "keyword";
  if (/match|substitutes|complements/.test(r.text)) return "auto";
  return "product";
}

export function suggestBid(r: TargetRow, targetAcos: number, accountCvr: number): Pick<TargetRow, "suggestedBid" | "suggestion"> {
  if (r.state && r.state !== "enabled") return { suggestedBid: null, suggestion: "Not enabled" };
  const base = r.bid ?? (r.clicks ? r.cost / r.clicks : null);
  if (base == null) return { suggestedBid: null, suggestion: "No bid data" };
  if (r.clicks < MIN_CLICKS) return { suggestedBid: null, suggestion: `Needs ${MIN_CLICKS}+ clicks` };

  let ratio: number;
  let why: string;
  if (r.orders === 0) {
    const expected = r.clicks * accountCvr;
    if (expected < 1.5) return { suggestedBid: null, suggestion: "Too early to judge" };
    ratio = 1 - MAX_STEP;
    why = `No orders from ${r.clicks} clicks`;
  } else {
    const acos = r.cost / r.sales;
    ratio = targetAcos / acos;
    if (Math.abs(ratio - 1) < 0.05) return { suggestedBid: null, suggestion: "On target" };
    why = ratio < 1 ? `ACOS ${(acos * 100).toFixed(0)}% above target` : `ACOS ${(acos * 100).toFixed(0)}% — room to bid up`;
    ratio = Math.min(1 + MAX_STEP, Math.max(1 - MAX_STEP, ratio));
  }
  const suggested = Math.max(MIN_BID_INR, Math.round(base * ratio * 100) / 100);
  return { suggestedBid: suggested, suggestion: why };
}

export function getTargets(range: Range, targetAcos: number, campaignId?: string) {
  const rows = stmt.all({ ...range, campaignId: campaignId ?? null }) as TargetRow[];
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  const accountCvr = clicks ? orders / clicks : 0;
  return {
    range,
    accountCvr,
    rows: rows.map((r) => {
      const withKind = { ...r, kind: inferKind(r), bidIsDefault: !!r.bidIsDefault };
      return { ...withKind, ...suggestBid(withKind, targetAcos, accountCvr) };
    }),
  };
}
