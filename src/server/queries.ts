import { db, initSchema } from "../db/client.js";

/**
 * Read-only queries behind the dashboard API. All aggregation happens in SQLite so
 * the browser only ever receives the handful of rows it renders.
 * Nothing in this file writes to Amazon — or to the DB beyond creating tables.
 */

initSchema();

export interface Totals {
  cost: number;
  sales: number;
  impressions: number;
  clicks: number;
  orders: number;
}

export interface DailyPoint extends Totals {
  date: string;
}

export interface CampaignRow extends Totals {
  adProduct: "sp" | "sb" | "sd";
  campaignId: string;
  name: string;
  state: string | null;
  targetingType: string | null;
  dailyBudget: number | null;
  prevCost: number;
  prevSales: number;
  /** Days in range where spend reached >= 95% of the *current* daily budget. */
  budgetCappedDays: number;
  activeDays: number;
}

export interface Range {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Same-length window immediately before `range` — used for every "vs previous period" delta. */
export function previousRange({ from, to }: Range): Range {
  const days = Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS) + 1;
  return {
    from: fmt(new Date(toDate(from).getTime() - days * DAY_MS)),
    to: fmt(new Date(toDate(from).getTime() - DAY_MS)),
  };
}

const TOTALS_SQL = `
  COALESCE(SUM(cost), 0)        AS cost,
  COALESCE(SUM(sales), 0)       AS sales,
  COALESCE(SUM(impressions), 0) AS impressions,
  COALESCE(SUM(clicks), 0)      AS clicks,
  COALESCE(SUM(orders), 0)      AS orders`;

/** `@ad` is 'sp' | 'sb' | 'sd', or NULL for all ad types. */
const AD = `(@ad IS NULL OR ad_product = @ad)`;

const stmts = {
  totals: db.prepare(`SELECT ${TOTALS_SQL} FROM all_campaign_daily WHERE date BETWEEN @from AND @to AND ${AD}`),
  daily: db.prepare(`
    SELECT date, ${TOTALS_SQL} FROM all_campaign_daily
    WHERE date BETWEEN @from AND @to AND ${AD} GROUP BY date ORDER BY date`),
  byProduct: db.prepare(`
    SELECT ad_product AS adProduct, ${TOTALS_SQL} FROM all_campaign_daily
    WHERE date BETWEEN @from AND @to GROUP BY ad_product`),
  campaigns: db.prepare(`
    WITH cur AS (
      SELECT ad_product, campaign_id, MAX(campaign_name) AS campaign_name, ${TOTALS_SQL},
             COUNT(*) AS active_days
      FROM all_campaign_daily WHERE date BETWEEN @from AND @to AND ${AD} GROUP BY ad_product, campaign_id
    ),
    prev AS (
      SELECT ad_product, campaign_id, SUM(cost) AS cost, SUM(sales) AS sales
      FROM all_campaign_daily WHERE date BETWEEN @prevFrom AND @prevTo AND ${AD} GROUP BY ad_product, campaign_id
    ),
    capped AS (
      SELECT m.ad_product, m.campaign_id, COUNT(*) AS n
      FROM all_campaign_daily m
      JOIN all_campaigns c ON c.ad_product = m.ad_product AND c.campaign_id = m.campaign_id
      WHERE m.date BETWEEN @from AND @to AND c.daily_budget > 0 AND m.cost >= 0.95 * c.daily_budget
      GROUP BY m.ad_product, m.campaign_id
    ),
    ids AS (
      SELECT ad_product, campaign_id FROM cur
      UNION SELECT ad_product, campaign_id FROM all_campaigns WHERE state = 'enabled' AND ${AD}
    )
    SELECT ids.ad_product                           AS adProduct,
           ids.campaign_id                          AS campaignId,
           COALESCE(c.name, cur.campaign_name, ids.campaign_id) AS name,
           c.state                                  AS state,
           c.subtype                                AS targetingType,
           c.daily_budget                           AS dailyBudget,
           COALESCE(cur.cost, 0)        AS cost,
           COALESCE(cur.sales, 0)       AS sales,
           COALESCE(cur.impressions, 0) AS impressions,
           COALESCE(cur.clicks, 0)      AS clicks,
           COALESCE(cur.orders, 0)      AS orders,
           COALESCE(cur.active_days, 0) AS activeDays,
           COALESCE(prev.cost, 0)       AS prevCost,
           COALESCE(prev.sales, 0)      AS prevSales,
           COALESCE(capped.n, 0)        AS budgetCappedDays
    FROM ids
    LEFT JOIN cur    ON cur.ad_product = ids.ad_product AND cur.campaign_id = ids.campaign_id
    LEFT JOIN prev   ON prev.ad_product = ids.ad_product AND prev.campaign_id = ids.campaign_id
    LEFT JOIN capped ON capped.ad_product = ids.ad_product AND capped.campaign_id = ids.campaign_id
    LEFT JOIN all_campaigns c ON c.ad_product = ids.ad_product AND c.campaign_id = ids.campaign_id
    ORDER BY cost DESC`),
  campaignInfo: db.prepare(`
    SELECT ad_product AS adProduct, campaign_id AS campaignId, name, state, subtype AS targetingType,
           daily_budget AS dailyBudget, start_date AS startDate, end_date AS endDate
    FROM all_campaigns WHERE campaign_id = @id AND ${AD} LIMIT 1`),
  campaignNameFromMetrics: db.prepare(`
    SELECT ad_product AS adProduct, campaign_id AS campaignId, MAX(campaign_name) AS name
    FROM all_campaign_daily WHERE campaign_id = @id AND ${AD} GROUP BY ad_product, campaign_id LIMIT 1`),
  campaignTotals: db.prepare(`
    SELECT ${TOTALS_SQL} FROM all_campaign_daily
    WHERE ad_product = @ad AND campaign_id = @id AND date BETWEEN @from AND @to`),
  campaignDaily: db.prepare(`
    SELECT date, ${TOTALS_SQL} FROM all_campaign_daily
    WHERE ad_product = @ad AND campaign_id = @id AND date BETWEEN @from AND @to GROUP BY date ORDER BY date`),
  dataRange: db.prepare(`SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM all_campaign_daily`),
  products: db.prepare(`SELECT DISTINCT ad_product FROM all_campaigns UNION SELECT DISTINCT ad_product FROM all_campaign_daily`).pluck(),
  meta: db.prepare(`SELECT value FROM meta WHERE key = ?`),
  profile: db.prepare(`SELECT profile_id AS profileId, country_code AS countryCode, currency_code AS currencyCode,
                              account_name AS accountName FROM profiles ORDER BY (country_code = 'IN') DESC LIMIT 1`),
  lastRuns: db.prepare(`
    SELECT job, started_at AS startedAt, finished_at AS finishedAt, status, rows_synced AS rowsSynced, detail
    FROM sync_runs s WHERE id = (SELECT MAX(id) FROM sync_runs WHERE job = s.job)`),
  lastSuccess: db.prepare(`
    SELECT job, MAX(finished_at) AS finishedAt FROM sync_runs WHERE status = 'success' GROUP BY job`),
  recentRuns: db.prepare(`
    SELECT id, job, started_at AS startedAt, finished_at AS finishedAt, status, rows_synced AS rowsSynced, detail
    FROM sync_runs ORDER BY id DESC LIMIT 50`),
  counts: db.prepare(`
    SELECT (SELECT COUNT(*) FROM all_campaigns) AS campaigns,
           (SELECT COUNT(*) FROM all_campaign_daily) AS dailyRows,
           (SELECT COUNT(*) FROM sp_targets) AS targets,
           (SELECT COUNT(*) FROM sp_search_term_daily_metrics) AS searchTermRows`),
  searchTermRange: db.prepare(`SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM sp_search_term_daily_metrics`),
  dataVersion: db.prepare(`PRAGMA data_version`).pluck(),
};

/** Changes whenever another connection (e.g. a sync job) commits — used to invalidate the response cache. */
export function dataVersion(): number {
  return stmts.dataVersion.get() as number;
}

export function getMeta() {
  const range = stmts.dataRange.get() as { minDate: string | null; maxDate: string | null };
  const source = (stmts.meta.get("data_source") as { value: string } | undefined)?.value;
  const counts = stmts.counts.get() as { campaigns: number; dailyRows: number; targets: number; searchTermRows: number };
  return {
    dataSource: source === "demo" ? "demo" : counts.dailyRows > 0 || counts.campaigns > 0 ? "live" : "empty",
    minDate: range.minDate,
    maxDate: range.maxDate,
    profile: stmts.profile.get() ?? null,
    counts,
    searchTerms: stmts.searchTermRange.get(),
    /** Ad products that have any campaigns or data — the UI only offers these in its ad-type switch. */
    adProducts: stmts.products.all() as AdProduct[],
  };
}

export type AdProduct = "sp" | "sb" | "sd";

export function getOverview(range: Range, ad: AdProduct | null) {
  const prev = previousRange(range);
  return {
    range,
    previousRange: prev,
    current: stmts.totals.get({ ...range, ad }) as Totals,
    previous: stmts.totals.get({ ...prev, ad }) as Totals,
    daily: stmts.daily.all({ ...range, ad }) as DailyPoint[],
    previousDaily: stmts.daily.all({ ...prev, ad }) as DailyPoint[],
    // Always across all ad types: powers the "by ad type" split on the Overview.
    byProduct: stmts.byProduct.all(range) as (Totals & { adProduct: AdProduct })[],
    previousByProduct: stmts.byProduct.all(prev) as (Totals & { adProduct: AdProduct })[],
  };
}

export function getCampaigns(range: Range, ad: AdProduct | null) {
  const prev = previousRange(range);
  return {
    range,
    previousRange: prev,
    campaigns: stmts.campaigns.all({ ...range, prevFrom: prev.from, prevTo: prev.to, ad }) as CampaignRow[],
  };
}

export function getCampaign(id: string, range: Range, ad: AdProduct | null) {
  const info = (stmts.campaignInfo.get({ id, ad }) ?? stmts.campaignNameFromMetrics.get({ id, ad })) as
    | { adProduct: AdProduct }
    | undefined;
  if (!info) return null;
  const prev = previousRange(range);
  const key = { id, ad: info.adProduct };
  return {
    range,
    previousRange: prev,
    campaign: info,
    current: stmts.campaignTotals.get({ ...key, ...range }) as Totals,
    previous: stmts.campaignTotals.get({ ...key, ...prev }) as Totals,
    daily: stmts.campaignDaily.all({ ...key, ...range }) as DailyPoint[],
  };
}

export function getSyncStatus() {
  return {
    lastRuns: stmts.lastRuns.all(),
    lastSuccess: stmts.lastSuccess.all(),
    recentRuns: stmts.recentRuns.all(),
    counts: stmts.counts.get(),
  };
}
