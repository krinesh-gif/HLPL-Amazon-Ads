# Aravi Dashboard — Ads Integration slice

This is the first slice of an in-house replacement for the Nola dashboard: just the
Amazon Ads API connection and a daily pull of Sponsored Products campaigns and
performance into a local database. Nothing else from the full spec yet on purpose —
get this one thing solid, then add the next screen.

## What's here

```
src/
  config/env.ts        loads and validates .env
  amazon-ads/
    auth.ts             Login with Amazon (LWA) OAuth — get/refresh access tokens
    client.ts            shared fetch wrapper (auth headers, error handling)
    profiles.ts           list advertising profiles (accounts/marketplaces)
    campaigns.ts           list Sponsored Products campaigns
    reports.ts               request/poll/download performance reports
  db/
    schema.sql          SQLite tables: profiles, sp_campaigns, sp_campaign_daily_metrics
    client.ts           SQLite connection + schema init
  sync/
    syncProfiles.ts     one-off: list profiles so you can pick AMAZON_ADS_PROFILE_ID
    syncCampaigns.ts    pull current campaign settings
    syncReports.ts      pull daily performance for the last N days
  cli.ts                entry point tying the above together
scripts/
  get-auth-url.ts       step 1 of one-time OAuth setup
  exchange-code.ts      step 2 of one-time OAuth setup
```

Plus the **read-only web dashboard** (slice two) on top of that data:

```
src/server/
  index.ts            Hono server: JSON API + serves the built UI (binds 127.0.0.1 — no login yet)
  queries.ts          dashboard SQL (aggregation happens in SQLite, not the browser)
  targets.ts          keywords & targets + suggested-bid rule
  searchTerms.ts      search-term harvest / negate rules
src/demo/seedDemo.ts  fake-but-realistic demo data, flagged as demo in the DB and UI
src/sync/syncRuns.ts  logs every sync:* run to sync_runs (powers the Sync status screen)
web/                  React + Vite UI (no UI/chart libraries — hand-rolled SVG charts)
  src/pages/          Overview, Campaigns, Campaign detail, Keywords, Search terms, Insights, Sync status
```

## The dashboard

```bash
npm run demo        # no Amazon credentials needed: seeds data/demo.sqlite with FAKE data and opens the dev server
npm run dev         # same dev server on your real data/aravi-ads.sqlite → http://localhost:5173
npm run build && npm start   # production build, served at http://127.0.0.1:8787
```

Screens (modelled on Nola's, read-only):
- **Overview** — 10 KPI tiles (Spend, Sales, ACOS, ROAS, Orders, Impressions, Clicks, CTR, CPC,
  CVR) with change vs the previous period; click a tile to chart it against the previous period;
  spend vs sales trend; top campaigns; "needs attention" list.
- **Campaigns** — sortable/searchable/filterable table with totals and CSV export.
- **Campaign detail** — per-campaign KPIs, daily chart (with the budget line on Spend), daily table.
- **Keywords & targets** — every keyword, product (ASIN) target and auto-target group with bid,
  performance and a **suggested bid** (moves toward target ACOS, max ±30% per step, needs 10+ clicks;
  no-order targets cut only once the account's conversion rate says an order was due).
- **Search terms** — every customer search term with what matched it. **Harvest** view: terms
  converting via auto/broad/phrase/product targeting that aren't exact keywords (or ASIN targets)
  yet. **Negate** view: terms with enough clicks and no orders (or ACOS over 2× target), per ad
  group, skipping ones already negated. Thresholds are adjustable; CSV export for bulk upload.
- **Insights** — rule-based suggestions against your target ACOS (spend without sales, ACOS over
  target, budget-capped but profitable, room to scale, spend spikes). Suggestions only.
- **Sync status** — last run and history of each `sync:*` job, stale-data warnings
  (the equivalent of Nola's Refetch Config screen).

Date ranges, filters, sort and selected metric live in the URL, so any view can be bookmarked.
Works from phone width up; light and dark mode.

**Nothing in the dashboard writes to Amazon.** Any future bid/budget/pause actions must go through
the staged "ready to deploy" design in CLAUDE.md — discuss before building.

**Don't expose the server publicly yet** (`HOST=0.0.0.0`): there's no login. Add auth first.

## Getting Amazon Ads API access (do this first — it's the slow part)

This is a manual approval process on Amazon's side, separate from writing any code.
Budget a few days to a couple of weeks for approval; do this in parallel with reading
the code below, not after.

1. **Confirm you have an Amazon Ads (Advertising Console) account** for Aravi Organic —
   you already advertise, so this exists. Note which Amazon login (email) has admin
   access to it; you'll use that same login for the developer steps below.

2. **Register as an Amazon Ads API developer.**
   Go to https://advertising.amazon.com/API/docs/en-us/setting-up/overview and follow
   "Register as a developer." This asks for basic details about what you're building
   (internal analytics/automation dashboard for your own ad account is a normal,
   fine answer) and submits a request for API access. Approval is manual and can take
   time — there's no way to speed this up from our side.

3. **While waiting (or once approved), create a Login with Amazon (LWA) security profile**
   at https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html.
   This is what gives you `AMAZON_ADS_CLIENT_ID` and `AMAZON_ADS_CLIENT_SECRET`.
   - Under "Web Settings" for the security profile, add an **Allowed Return URL**.
     For local development this should match `AMAZON_ADS_REDIRECT_URI` in `.env`
     (default `http://localhost:3456/callback`). This doesn't need to be a real
     running server yet — you'll just copy the `code` out of the browser's address
     bar after Amazon redirects there.

4. **Once your Ads API access is approved**, copy `.env.example` to `.env` and fill in
   `AMAZON_ADS_CLIENT_ID` and `AMAZON_ADS_CLIENT_SECRET` from the LWA security profile.
   Leave `AMAZON_ADS_REGION=EU` — India's Ads API traffic is served from the EU region
   endpoint regardless of the marketplace being amazon.in.

5. **Run the one-time OAuth consent flow** (this is what `auth.ts` implements):
   ```bash
   npm install
   npm run auth:url
   ```
   Open the printed URL, log in as the Amazon Ads admin user for Aravi, approve access.
   Amazon redirects to your `AMAZON_ADS_REDIRECT_URI` with `?code=...` in the address bar
   — nothing needs to be listening there, just copy the `code` value out of the URL. Then:
   ```bash
   npm run auth:exchange -- <the code>
   ```
   This prints an `AMAZON_ADS_REFRESH_TOKEN` — put it in `.env`. It's long-lived; you
   should not need to repeat steps 5 again under normal use.

6. **Find your profile ID** (which marketplace/account the API calls should target):
   ```bash
   npm run sync:profiles
   ```
   This lists every profile the logged-in user can access. Find the one with
   `country=IN` and put its `profileId` into `.env` as `AMAZON_ADS_PROFILE_ID`.

## Day-to-day use, once set up

```bash
npm run db:init          # create the SQLite file/tables (data/aravi-ads.sqlite)
npm run sync:campaigns    # pull current SP campaign settings
npm run sync:reports      # pull the last 7 days of daily SP campaign performance
npm run sync:reports -- 30   # or a different number of days back
npm run sync:keywords     # ad groups, keywords, product/auto targets, negative keywords (current settings)
npm run sync:targeting    # daily performance per keyword/target (default last 14 days)
npm run sync:search-terms # daily customer search terms (default last 14 days; run `-- 60` once to backfill)
npm run sync:all          # the daily job: campaigns + keywords + last 14 days of all three reports
```

Report syncs split longer ranges into ≤31-day windows automatically (Amazon's per-report limit).
Amazon keeps search-term data only for a limited window (roughly 60–90 days), so backfill
it early and then keep `sync:all` running daily.

**Not yet verified against the live API:** the `spTargeting` / `spSearchTerm` report columns and
the v3 list endpoints for ad groups, keywords, targets and negatives follow Amazon's docs but
haven't run against a real account from this repo. Check the first real `sync:all` output.

Query the results directly with any SQLite tool, e.g.:
```bash
sqlite3 data/aravi-ads.sqlite "select date, campaign_name, cost, sales_14d from sp_campaign_daily_metrics order by date desc limit 20;"
```

## Notes and near-term TODOs

- **Only Sponsored Products is wired up.** Sponsored Brands and Sponsored Display use
  slightly different endpoints/content-types (see the comment in `campaigns.ts`) —
  copy that file's shape for `sbCampaigns.ts` / `sdCampaigns.ts` when you get here.
- **No scheduling yet.** `npm run sync:reports` is manual. Once this is proven reliable,
  wrap it in a cron job / scheduled task (matches the "Daily AMS Fetch" job on Nola's
  Refetch Config screen) rather than building a scheduler from scratch.
- **Re-pull the last 14 days daily.** Amazon keeps updating 14-day attributed sales after the
  day itself, so `sync:reports -- 14` (not 1) is the right daily job.
- **SQLite is a deliberate starting choice**, not a long-term one — zero setup, one file,
  easy to inspect. Swap `src/db/client.ts` for Postgres once more than one person needs
  to query this or it needs to sit behind a web app.
- **Secrets:** `.env` is gitignored. Never commit real credentials; `.env.example` is the
  only file meant to be checked in.
- **Vendor Central (VC) data** is a separate, harder integration (Amazon doesn't expose
  it through this same Ads API) — deliberately out of scope for this slice.
