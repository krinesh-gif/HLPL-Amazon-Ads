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

-- ---- Keywords, targets and search terms (slice three) ----
-- Enum values (state, match type) are stored lower-case, as with sp_campaigns.

CREATE TABLE IF NOT EXISTS sp_ad_groups (
  ad_group_id  TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  state        TEXT NOT NULL,
  default_bid  REAL,
  synced_at    TEXT NOT NULL
);

-- Keywords and targeting clauses share one table: Amazon's reports put both ids in the
-- same `keywordId` column, and the dashboard lists them side by side.
CREATE TABLE IF NOT EXISTS sp_targets (
  target_id    TEXT PRIMARY KEY,       -- keywordId for keywords, targetId for targets
  kind         TEXT NOT NULL,          -- 'keyword' | 'product' | 'auto'
  campaign_id  TEXT NOT NULL,
  ad_group_id  TEXT NOT NULL,
  text         TEXT NOT NULL,          -- keyword text, or e.g. asin="B0…" / close-match
  match_type   TEXT,                   -- exact | phrase | broad (keywords only)
  state        TEXT NOT NULL,
  bid          REAL,                   -- NULL = ad group default bid
  synced_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sp_targets_campaign ON sp_targets (campaign_id);

CREATE TABLE IF NOT EXISTS sp_negative_keywords (
  negative_id  TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  ad_group_id  TEXT,                   -- NULL = campaign-level negative
  text         TEXT NOT NULL,
  match_type   TEXT NOT NULL,          -- negative_exact | negative_phrase
  synced_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sp_target_daily_metrics (
  date           TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  ad_group_id    TEXT NOT NULL,
  text           TEXT,                 -- as reported (keyword or targeting expression)
  match_type     TEXT,
  impressions    INTEGER NOT NULL DEFAULT 0,
  clicks         INTEGER NOT NULL DEFAULT 0,
  cost           REAL NOT NULL DEFAULT 0,
  sales_14d      REAL NOT NULL DEFAULT 0,
  purchases_14d  INTEGER NOT NULL DEFAULT 0,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (date, target_id)
);
CREATE INDEX IF NOT EXISTS idx_sp_target_daily_target ON sp_target_daily_metrics (target_id, date);

CREATE TABLE IF NOT EXISTS sp_search_term_daily_metrics (
  date           TEXT NOT NULL,
  search_term    TEXT NOT NULL,
  target_id      TEXT NOT NULL,        -- keyword/target that matched the search
  campaign_id    TEXT NOT NULL,
  ad_group_id    TEXT NOT NULL,
  targeting      TEXT,                 -- keyword text or expression, as reported
  match_type     TEXT,
  impressions    INTEGER NOT NULL DEFAULT 0,
  clicks         INTEGER NOT NULL DEFAULT 0,
  cost           REAL NOT NULL DEFAULT 0,
  sales_14d      REAL NOT NULL DEFAULT 0,
  purchases_14d  INTEGER NOT NULL DEFAULT 0,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (date, target_id, search_term)
);
CREATE INDEX IF NOT EXISTS idx_sp_st_daily_campaign ON sp_search_term_daily_metrics (campaign_id, date);

-- ---- Sponsored Brands & Sponsored Display (slice four) ----
-- Own tables per ad product (each API has its own shape), unified for the
-- dashboard by the all_campaigns / all_campaign_daily views below.

CREATE TABLE IF NOT EXISTS sb_campaigns (
  campaign_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  state        TEXT NOT NULL,
  budget       REAL,
  budget_type  TEXT,                  -- daily | lifetime
  cost_type    TEXT,
  start_date   TEXT,
  end_date     TEXT,
  synced_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sd_campaigns (
  campaign_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  state        TEXT NOT NULL,
  tactic       TEXT,                  -- contextual | audiences
  budget       REAL,
  budget_type  TEXT,
  cost_type    TEXT,
  start_date   TEXT,
  end_date     TEXT,
  synced_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sb_campaign_daily_metrics (
  date           TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  campaign_name  TEXT,
  impressions    INTEGER NOT NULL DEFAULT 0,
  clicks         INTEGER NOT NULL DEFAULT 0,
  cost           REAL NOT NULL DEFAULT 0,
  sales          REAL NOT NULL DEFAULT 0,
  purchases      INTEGER NOT NULL DEFAULT 0,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (date, campaign_id)
);

CREATE TABLE IF NOT EXISTS sd_campaign_daily_metrics (
  date           TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  campaign_name  TEXT,
  impressions    INTEGER NOT NULL DEFAULT 0,
  clicks         INTEGER NOT NULL DEFAULT 0,
  cost           REAL NOT NULL DEFAULT 0,
  sales          REAL NOT NULL DEFAULT 0,
  purchases      INTEGER NOT NULL DEFAULT 0,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (date, campaign_id)
);

CREATE VIEW IF NOT EXISTS all_campaigns AS
  SELECT 'sp' AS ad_product, campaign_id, name, state, targeting_type AS subtype,
         daily_budget, start_date, end_date
    FROM sp_campaigns
  UNION ALL
  SELECT 'sb', campaign_id, name, state, NULLIF(budget_type, 'daily'),
         CASE WHEN budget_type = 'daily' THEN budget END, start_date, end_date
    FROM sb_campaigns
  UNION ALL
  SELECT 'sd', campaign_id, name, state, tactic,
         CASE WHEN budget_type = 'daily' THEN budget END, start_date, end_date
    FROM sd_campaigns;

CREATE VIEW IF NOT EXISTS all_campaign_daily AS
  SELECT 'sp' AS ad_product, date, campaign_id, campaign_name, impressions, clicks, cost,
         sales_14d AS sales, purchases_14d AS orders
    FROM sp_campaign_daily_metrics
  UNION ALL
  SELECT 'sb', date, campaign_id, campaign_name, impressions, clicks, cost, sales, purchases
    FROM sb_campaign_daily_metrics
  UNION ALL
  SELECT 'sd', date, campaign_id, campaign_name, impressions, clicks, cost, sales, purchases
    FROM sd_campaign_daily_metrics;

-- ---- Login + staged changes / deploys (slice five) ----

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,            -- scrypt$N$salt$hash
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,            -- sha256 of the cookie value; the raw token is never stored
  user_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- The "ready to deploy" queue. Nothing in here has touched Amazon until a deploy runs.
CREATE TABLE IF NOT EXISTS change_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,   -- bid | state | negative | harvest | remove_negative | archive_keyword
  status          TEXT NOT NULL,   -- staged | deployed | demo_applied | dry_run | failed | discarded
  entity_key      TEXT NOT NULL,   -- one staged change per thing, e.g. bid:<targetId>
  target_kind     TEXT,            -- keyword | product | auto (for bid/state), keyword | asin (negative/harvest)
  entity_id       TEXT,            -- existing keyword/target id, or the id Amazon returned for a create
  campaign_id     TEXT NOT NULL,
  ad_group_id     TEXT NOT NULL,
  label           TEXT NOT NULL,   -- keyword text / target expression / search term
  old_value       TEXT,            -- JSON
  new_value       TEXT NOT NULL,   -- JSON
  est_daily_cost_delta REAL,       -- rough ₹/day impact, shown before deploy
  reason          TEXT,
  source          TEXT NOT NULL,   -- keywords | search-terms | revert
  revert_of       INTEGER,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  deploy_id       INTEGER,
  result_message  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_change_queue_staged ON change_queue (entity_key) WHERE status = 'staged';
CREATE INDEX IF NOT EXISTS idx_change_queue_status ON change_queue (status, id);

CREATE TABLE IF NOT EXISTS deploys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mode         TEXT NOT NULL,      -- live | dry_run | demo
  deployed_by  TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  total        INTEGER NOT NULL,
  succeeded    INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  est_daily_cost_delta REAL
);

-- ---- Setup: product catalogue, SB mapper, data imports (slice six) ----
-- Local business data only; nothing here is ever written to Amazon.

CREATE TABLE IF NOT EXISTS products (
  asin           TEXT PRIMARY KEY,     -- upper-case
  sku            TEXT,
  title          TEXT,
  product_group  TEXT,                 -- e.g. Hair Care / Skin Care — your own grouping
  mrp            REAL,
  selling_price  REAL,
  unit_cost      REAL,                 -- landed cost / COGS per unit
  status         TEXT NOT NULL DEFAULT 'active',   -- active | inactive
  source         TEXT NOT NULL,        -- sync | import | manual | demo
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sp_product_ads (
  ad_id        TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  ad_group_id  TEXT NOT NULL,
  asin         TEXT,
  sku          TEXT,
  state        TEXT NOT NULL,
  synced_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sp_product_ads_asin ON sp_product_ads (asin);

CREATE TABLE IF NOT EXISTS sp_advertised_product_daily (
  date           TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  ad_group_id    TEXT NOT NULL,
  asin           TEXT NOT NULL,
  sku            TEXT,
  impressions    INTEGER NOT NULL DEFAULT 0,
  clicks         INTEGER NOT NULL DEFAULT 0,
  cost           REAL NOT NULL DEFAULT 0,
  sales_14d      REAL NOT NULL DEFAULT 0,
  purchases_14d  INTEGER NOT NULL DEFAULT 0,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (date, ad_group_id, asin)
);
CREATE INDEX IF NOT EXISTS idx_sp_adv_product_asin ON sp_advertised_product_daily (asin, date);

-- SB campaign mapper: which products an SB campaign promotes. Its spend/sales are split
-- across the mapped ASINs by weight (equal by default) for product-level reporting.
CREATE TABLE IF NOT EXISTS sb_campaign_products (
  campaign_id  TEXT NOT NULL,
  asin         TEXT NOT NULL,
  weight       REAL NOT NULL DEFAULT 1,
  updated_by   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (campaign_id, asin)
);

-- Seller Central Business Report (Detail Page Sales and Traffic by Child Item) — total
-- (organic + ad) sales and traffic per ASIN for the period the file covers.
CREATE TABLE IF NOT EXISTS business_report (
  asin          TEXT NOT NULL,
  period_from   TEXT NOT NULL,
  period_to     TEXT NOT NULL,
  sessions      INTEGER,
  page_views    INTEGER,
  units         INTEGER,
  order_items   INTEGER,
  sales         REAL,
  import_id     INTEGER,
  PRIMARY KEY (asin, period_from, period_to)
);

CREATE TABLE IF NOT EXISTS data_imports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,          -- products | business_report | sb_mapping
  filename     TEXT,
  period_from  TEXT,
  period_to    TEXT,
  rows_total   INTEGER NOT NULL,
  rows_imported INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  imported_by  TEXT NOT NULL,
  imported_at  TEXT NOT NULL
);
