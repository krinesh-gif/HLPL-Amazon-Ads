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
  COALESCE(SUM(cost), 0)          AS cost,
  COALESCE(SUM(sales_14d), 0)     AS sales,
  COALESCE(SUM(impressions), 0)   AS impressions,
  COALESCE(SUM(clicks), 0)        AS clicks,
  COALESCE(SUM(purchases_14d), 0) AS orders`;

const stmts = {
  totals: db.prepare(`SELECT ${TOTALS_SQL} FROM sp_campaign_daily_metrics WHERE date BETWEEN @from AND @to`),
  daily: db.prepare(`
    SELECT date, ${TOTALS_SQL} FROM sp_campaign_daily_metrics
    WHERE date BETWEEN @from AND @to GROUP BY date ORDER BY date`),
  campaigns: db.prepare(`
    WITH cur AS (
      SELECT campaign_id, MAX(campaign_name) AS campaign_name, ${TOTALS_SQL},
             COUNT(*) AS active_days
      FROM sp_campaign_daily_metrics WHERE date BETWEEN @from AND @to GROUP BY campaign_id
    ),
    prev AS (
      SELECT campaign_id, SUM(cost) AS cost, SUM(sales_14d) AS sales
      FROM sp_campaign_daily_metrics WHERE date BETWEEN @prevFrom AND @prevTo GROUP BY campaign_id
    ),
    capped AS (
      SELECT m.campaign_id, COUNT(*) AS n
      FROM sp_campaign_daily_metrics m JOIN sp_campaigns c ON c.campaign_id = m.campaign_id
      WHERE m.date BETWEEN @from AND @to AND c.daily_budget > 0 AND m.cost >= 0.95 * c.daily_budget
      GROUP BY m.campaign_id
    ),
    ids AS (
      SELECT campaign_id FROM cur
      UNION SELECT campaign_id FROM sp_campaigns WHERE state = 'enabled'
    )
    SELECT ids.campaign_id                          AS campaignId,
           COALESCE(c.name, cur.campaign_name, ids.campaign_id) AS name,
           c.state                                  AS state,
           c.targeting_type                         AS targetingType,
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
    LEFT JOIN cur    ON cur.campaign_id = ids.campaign_id
    LEFT JOIN prev   ON prev.campaign_id = ids.campaign_id
    LEFT JOIN capped ON capped.campaign_id = ids.campaign_id
    LEFT JOIN sp_campaigns c ON c.campaign_id = ids.campaign_id
    ORDER BY cost DESC`),
  campaignInfo: db.prepare(`
    SELECT c.campaign_id AS campaignId, c.name, c.state, c.targeting_type AS targetingType,
           c.daily_budget AS dailyBudget, c.start_date AS startDate, c.end_date AS endDate,
           c.synced_at AS syncedAt
    FROM sp_campaigns c WHERE c.campaign_id = ?`),
  campaignNameFromMetrics: db.prepare(`
    SELECT campaign_id AS campaignId, MAX(campaign_name) AS name
    FROM sp_campaign_daily_metrics WHERE campaign_id = ? GROUP BY campaign_id`),
  campaignTotals: db.prepare(`
    SELECT ${TOTALS_SQL} FROM sp_campaign_daily_metrics
    WHERE campaign_id = @id AND date BETWEEN @from AND @to`),
  campaignDaily: db.prepare(`
    SELECT date, ${TOTALS_SQL} FROM sp_campaign_daily_metrics
    WHERE campaign_id = @id AND date BETWEEN @from AND @to GROUP BY date ORDER BY date`),
  dataRange: db.prepare(`SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM sp_campaign_daily_metrics`),
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
    SELECT (SELECT COUNT(*) FROM sp_campaigns) AS campaigns,
           (SELECT COUNT(*) FROM sp_campaign_daily_metrics) AS dailyRows`),
  dataVersion: db.prepare(`PRAGMA data_version`).pluck(),
};

/** Changes whenever another connection (e.g. a sync job) commits — used to invalidate the response cache. */
export function dataVersion(): number {
  return stmts.dataVersion.get() as number;
}

export function getMeta() {
  const range = stmts.dataRange.get() as { minDate: string | null; maxDate: string | null };
  const source = (stmts.meta.get("data_source") as { value: string } | undefined)?.value;
  const counts = stmts.counts.get() as { campaigns: number; dailyRows: number };
  return {
    dataSource: source === "demo" ? "demo" : counts.dailyRows > 0 || counts.campaigns > 0 ? "live" : "empty",
    minDate: range.minDate,
    maxDate: range.maxDate,
    profile: stmts.profile.get() ?? null,
    counts,
  };
}

export function getOverview(range: Range) {
  const prev = previousRange(range);
  return {
    range,
    previousRange: prev,
    current: stmts.totals.get(range) as Totals,
    previous: stmts.totals.get(prev) as Totals,
    daily: stmts.daily.all(range) as DailyPoint[],
    previousDaily: stmts.daily.all(prev) as DailyPoint[],
  };
}

export function getCampaigns(range: Range) {
  const prev = previousRange(range);
  return {
    range,
    previousRange: prev,
    campaigns: stmts.campaigns.all({ ...range, prevFrom: prev.from, prevTo: prev.to }) as CampaignRow[],
  };
}

export function getCampaign(id: string, range: Range) {
  const info = stmts.campaignInfo.get(id) ?? stmts.campaignNameFromMetrics.get(id);
  if (!info) return null;
  const prev = previousRange(range);
  return {
    range,
    previousRange: prev,
    campaign: info,
    current: stmts.campaignTotals.get({ id, ...range }) as Totals,
    previous: stmts.campaignTotals.get({ id, ...prev }) as Totals,
    daily: stmts.campaignDaily.all({ id, ...range }) as DailyPoint[],
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
