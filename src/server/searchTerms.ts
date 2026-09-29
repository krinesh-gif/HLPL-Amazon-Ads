import { db } from "../db/client.js";
import type { Range } from "./queries.js";

/**
 * Search-term analysis, Nola-style:
 *  - Harvest: search terms converting well through auto / broad / phrase / product targeting
 *    that aren't yet exact keywords (or ASIN targets) of their own.
 *  - Negate: search terms burning spend with no (or very expensive) orders, per ad group,
 *    that aren't already negated there.
 * Suggestions only — nothing here writes to Amazon.
 */

export interface SearchTermOptions {
  range: Range;
  view: "all" | "harvest" | "negate";
  campaignId?: string;
  q?: string;
  targetAcos: number;
  minClicks: number;
  minOrders: number;
  sort: string;
  dir: "asc" | "desc";
  limit: number;
  offset: number;
}

interface SourceRow {
  searchTerm: string;
  targetId: string;
  campaignId: string;
  adGroupId: string;
  campaignName: string | null;
  adGroupName: string | null;
  sourceText: string | null;
  sourceKind: string | null; // keyword | product | auto (null = no longer in sp_targets)
  matchType: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
}

export interface SearchTermRow {
  key: string;
  searchTerm: string;
  isAsin: boolean;
  /** Where it came from. For harvest rows (aggregated per term) this is the top source. */
  campaignId: string;
  campaignName: string | null;
  adGroupId: string;
  adGroupName: string | null;
  sourceText: string | null;
  sourceKind: string | null;
  matchType: string | null;
  sourceCount: number;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  hasExactKeyword: boolean;
  negated: boolean;
  action: null | { type: "harvest" | "negate"; label: string; reason: string };
}

const sourcesStmt = db.prepare(`
  SELECT m.search_term AS searchTerm, m.target_id AS targetId, m.campaign_id AS campaignId,
         m.ad_group_id AS adGroupId, c.name AS campaignName, g.name AS adGroupName,
         COALESCE(t.text, MAX(m.targeting)) AS sourceText, t.kind AS sourceKind,
         COALESCE(t.match_type, MAX(m.match_type)) AS matchType,
         SUM(m.impressions) AS impressions, SUM(m.clicks) AS clicks, SUM(m.cost) AS cost,
         SUM(m.sales_14d) AS sales, SUM(m.purchases_14d) AS orders
  FROM sp_search_term_daily_metrics m
  LEFT JOIN sp_targets t   ON t.target_id = m.target_id
  LEFT JOIN sp_campaigns c ON c.campaign_id = m.campaign_id
  LEFT JOIN sp_ad_groups g ON g.ad_group_id = m.ad_group_id
  WHERE m.date BETWEEN @from AND @to AND (@campaignId IS NULL OR m.campaign_id = @campaignId)
  GROUP BY m.search_term, m.target_id`);
const exactKeywordsStmt = db.prepare(
  `SELECT DISTINCT lower(text) AS text FROM sp_targets WHERE kind = 'keyword' AND match_type = 'exact' AND state = 'enabled'`
).pluck();
const asinTargetsStmt = db.prepare(
  `SELECT DISTINCT lower(text) AS text FROM sp_targets WHERE kind = 'product' AND state = 'enabled'`
).pluck();
const negativesStmt = db.prepare(`SELECT campaign_id AS campaignId, ad_group_id AS adGroupId, text, match_type AS matchType FROM sp_negative_keywords`);

const ASIN_RE = /^b0[0-9a-z]{8}$/i;
const acosOf = (r: { cost: number; sales: number }) => (r.sales > 0 ? r.cost / r.sales : null);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/** Negative phrase match: every word of the negative appears in order, as whole words. */
function phraseMatches(term: string, phrase: string): boolean {
  return ` ${term} `.includes(` ${phrase} `);
}

export function getSearchTerms(o: SearchTermOptions) {
  const sources = sourcesStmt.all({ ...o.range, campaignId: o.campaignId ?? null }) as SourceRow[];
  const exact = new Set(exactKeywordsStmt.all() as string[]);
  const asinTargets = new Set(asinTargetsStmt.all() as string[]);
  const negatives = negativesStmt.all() as { campaignId: string; adGroupId: string | null; text: string; matchType: string }[];

  const negIndex = new Map<string, { text: string; matchType: string }[]>();
  for (const n of negatives) {
    const k = n.adGroupId ? `ag:${n.adGroupId}` : `c:${n.campaignId}`;
    (negIndex.get(k) ?? negIndex.set(k, []).get(k)!).push(n);
  }
  const isNegated = (s: SourceRow) =>
    [...(negIndex.get(`ag:${s.adGroupId}`) ?? []), ...(negIndex.get(`c:${s.campaignId}`) ?? [])].some((n) =>
      n.matchType === "negative_exact" ? n.text === s.searchTerm : phraseMatches(s.searchTerm, n.text)
    );
  const hasExact = (term: string) =>
    ASIN_RE.test(term) ? asinTargets.has(`asin="${term}"`) : exact.has(term);

  // ---- Per-source rows (all / negate views) ----
  const perSource: SearchTermRow[] = sources.map((s) => {
    const negated = isNegated(s);
    // A keyword's own text, or a product target's own ASIN: negating it would just switch the
    // target off — that's a bid decision, handled on the Keywords & targets screen.
    const src = s.sourceText?.toLowerCase();
    const isOwnExact = src === s.searchTerm || src === `asin="${s.searchTerm}"`;
    const a = acosOf(s);
    let action: SearchTermRow["action"] = null;
    if (!negated && !isOwnExact && s.clicks >= o.minClicks) {
      if (s.orders === 0) {
        action = { type: "negate", label: "Add negative exact", reason: `${s.clicks} clicks, ${inr(s.cost)} spent, no orders` };
      } else if (a != null && a > o.targetAcos * 2) {
        action = { type: "negate", label: "Add negative exact", reason: `ACOS ${pct(a)} — over 2× your ${pct(o.targetAcos)} target` };
      }
    }
    return {
      key: `${s.searchTerm}|${s.targetId}`, searchTerm: s.searchTerm, isAsin: ASIN_RE.test(s.searchTerm),
      campaignId: s.campaignId, campaignName: s.campaignName, adGroupId: s.adGroupId, adGroupName: s.adGroupName,
      sourceText: s.sourceText, sourceKind: s.sourceKind, matchType: s.matchType, sourceCount: 1,
      impressions: s.impressions, clicks: s.clicks, cost: s.cost, sales: s.sales, orders: s.orders,
      hasExactKeyword: hasExact(s.searchTerm), negated, action,
    };
  });

  // ---- Per-term rows (harvest view): judge a term on its combined performance ----
  const byTerm = new Map<string, SearchTermRow>();
  for (const r of perSource) {
    const t = byTerm.get(r.searchTerm);
    if (!t) {
      byTerm.set(r.searchTerm, { ...r, key: r.searchTerm, action: null });
      continue;
    }
    if (r.cost > t.cost) Object.assign(t, { campaignId: r.campaignId, campaignName: r.campaignName, adGroupId: r.adGroupId, adGroupName: r.adGroupName, sourceText: r.sourceText, sourceKind: r.sourceKind, matchType: r.matchType });
    t.sourceCount++;
    t.impressions += r.impressions; t.clicks += r.clicks; t.cost += r.cost; t.sales += r.sales; t.orders += r.orders;
  }
  const discoverySource = (r: SearchTermRow) => r.sourceKind !== "keyword" || r.matchType !== "exact";
  for (const t of byTerm.values()) {
    const a = acosOf(t);
    const fromDiscovery = perSource.some((r) => r.searchTerm === t.searchTerm && discoverySource(r) && r.orders > 0);
    if (!t.hasExactKeyword && fromDiscovery && t.orders >= o.minOrders && a != null && a <= o.targetAcos) {
      t.action = {
        type: "harvest",
        label: t.isAsin ? "Add as ASIN target" : "Add as exact keyword",
        reason: `${t.orders} orders at ${pct(a)} ACOS`,
      };
    }
  }

  const harvest = [...byTerm.values()].filter((t) => t.action?.type === "harvest");
  const negate = perSource.filter((r) => r.action?.type === "negate");
  let rows = o.view === "harvest" ? harvest : o.view === "negate" ? negate : perSource;

  const needle = o.q?.trim().toLowerCase();
  if (needle) rows = rows.filter((r) => r.searchTerm.includes(needle) || r.sourceText?.toLowerCase().includes(needle));

  const val = (r: SearchTermRow): number | string | null => {
    switch (o.sort) {
      case "searchTerm": return r.searchTerm;
      case "acos": return acosOf(r);
      case "cvr": return r.clicks ? r.orders / r.clicks : null;
      case "cpc": return r.clicks ? r.cost / r.clicks : null;
      case "sales": case "orders": case "clicks": case "impressions": return r[o.sort];
      default: return r.cost;
    }
  };
  const dir = o.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((x, y) => {
    const a = val(x), b = val(y);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a < b ? -1 : a > b ? 1 : 0) * dir;
  });

  const totals = rows.reduce(
    (t, r) => ({ impressions: t.impressions + r.impressions, clicks: t.clicks + r.clicks, cost: t.cost + r.cost, sales: t.sales + r.sales, orders: t.orders + r.orders }),
    { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 }
  );
  return {
    range: o.range,
    counts: { all: perSource.length, harvest: harvest.length, negate: negate.length },
    total: rows.length,
    totals,
    rows: rows.slice(o.offset, o.offset + o.limit),
  };
}
