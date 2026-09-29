-- Minimal schema for the Ads-integration slice. Deliberately small:
-- add tables as new sync jobs (ad groups, keywords, SB/SD) come online,
-- rather than modeling everything up front.

CREATE TABLE IF NOT EXISTS profiles (
  profile_id     TEXT PRIMARY KEY,
  country_code   TEXT NOT NULL,
  currency_code  TEXT NOT NULL,
  account_name   TEXT,
  account_type   TEXT,
  synced_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sp_campaigns (
  campaign_id    TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  state          TEXT NOT NULL,
  targeting_type TEXT NOT NULL,
  daily_budget   REAL NOT NULL,
  start_date     TEXT,
  end_date       TEXT,
  synced_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sp_campaign_daily_metrics (
  date           TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  campaign_name  TEXT,
  impressions    INTEGER NOT NULL DEFAULT 0,
  clicks         INTEGER NOT NULL DEFAULT 0,
  cost           REAL NOT NULL DEFAULT 0,
  sales_14d      REAL NOT NULL DEFAULT 0,
  purchases_14d  INTEGER NOT NULL DEFAULT 0,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (date, campaign_id)
);

-- Speeds up per-campaign date-range lookups (campaign detail screen).
-- The primary key already covers date-range scans across all campaigns.
CREATE INDEX IF NOT EXISTS idx_sp_daily_campaign_date
  ON sp_campaign_daily_metrics (campaign_id, date);

-- One row per `npm run sync:*` invocation — powers the dashboard's Sync status screen
-- (the equivalent of Nola's Refetch Config / "Daily AMS Fetch" history).
CREATE TABLE IF NOT EXISTS sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job          TEXT NOT NULL,          -- 'profiles' | 'campaigns' | 'reports'
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,          -- 'running' | 'success' | 'failed'
  rows_synced  INTEGER,
  detail       TEXT                    -- date range for reports, or the error message
);

-- Small key/value table. `data_source` = 'demo' marks a DB filled by `npm run db:seed-demo`
-- so the dashboard can show a clear "demo data" banner and never pass it off as real numbers.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
