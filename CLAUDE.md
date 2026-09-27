# Aravi Dashboard — Ads Integration slice

Read this before doing anything else in this repo. It's the context a fresh Claude Code
session won't otherwise have.

## What this project is

Krinesh (founder, Hivefy Lifestyle Pvt Ltd, brand Aravi Organic — D2C skincare/haircare,
sells on Amazon, Flipkart, Myntra, Nykaa, Meesho, Shopify in India) is replacing a
third-party dashboard called "Nola" with an in-house build, one slice at a time. This
repo is slice one: **just the Amazon Advertising API connection** — OAuth, pulling
Sponsored Products campaigns and daily performance into a local database. Nothing else
from the full Nola feature set yet, on purpose. Don't expand scope to other marketplaces,
other ad types, or a web UI unless explicitly asked.

Business also uses Unicommerce (OMS/WMS) and Tally (accounting) — not touched by this
slice, but relevant context if asked to integrate order/inventory data later.

## Current state (as of last session)

- `npm install` succeeds, `npx tsc --noEmit` passes clean, CLI smoke-tested.
- OAuth (`auth.ts`), campaign list (`campaigns.ts`), and the async Reporting API v3
  flow (`reports.ts`) are implemented for **Sponsored Products only**.
- SQLite (`better-sqlite3`) is the deliberate stopgap datastore — see README for when
  to swap it for Postgres.
- **Krinesh does not yet have Amazon Ads API credentials.** He needs to register as an
  Ads API developer and create an LWA security profile before any of this can run
  against real data — see README.md § "Getting Amazon Ads API access" for the exact
  steps and links. This is a manual approval process on Amazon's side (days to weeks);
  it is the actual blocker on this project, not the code.
- Full command reference, file layout, and near-term TODOs are in README.md — read
  it before making structural changes so you don't duplicate what's already decided
  there (e.g. why SQLite, why EU region for India traffic, why VC is out of scope).

## Design patterns to preserve

- **Eager env validation** (`src/config/env.ts`) — fails fast at import time if
  `AMAZON_ADS_CLIENT_ID`/`SECRET` are missing. Keep this; don't make it lazy just to
  make `--help` output prettier.
- **One function per Amazon Ads concern**, thin and testable (`profiles.ts`,
  `campaigns.ts`, `reports.ts` each do one thing). Follow this shape for new ad types
  (Sponsored Brands, Sponsored Display) rather than growing `campaigns.ts`.
- **Sync scripts are idempotent upserts** (`ON CONFLICT ... DO UPDATE`), run manually
  via `npm run sync:*`. There is no scheduler yet — see README TODOs before adding one.

## Important: how "deploy" / write actions should behave, if this ever grows write features

This slice is read-only against Amazon (it only pulls data). If a future slice adds
anything that **writes** to the live Amazon account (bid changes, pausing campaigns,
budget edits), copy the safety pattern Nola itself uses, confirmed by directly testing
it on the live Nola dashboard:

- Changes should be staged first (a "ready to deploy" queue), never pushed to Amazon's
  API the instant a user clicks an action button. A separate, explicit second step
  should be required to actually push to Amazon.
- Any bulk/scheduled rule that *does* bypass staging and writes straight to Amazon
  (Nola's "Rulesets" behave this way) must say so explicitly in the UI before the user
  turns it on.
- Anything with a real dollar/rupee cost attached (Nola's account-audit-style features)
  must show the cost estimate **before** the action commits, not after.

Don't build any write/deploy functionality without discussing the staging design with
Krinesh first — this is a live, revenue-generating ad account.

## Working conventions

- ESM + TypeScript, run directly with `tsx` (no separate build step during dev).
- Keep changes scoped to what's asked — this is intentionally a small, single-purpose
  slice, not the start of the full Nola clone in one PR.
- Never commit `.env` or real credentials (`.gitignore` already excludes it).
- If Amazon API credentials still aren't set up yet, most useful work is: code review,
  adding Sponsored Brands/Display support (mirroring `campaigns.ts`'s shape), tests,
  or scheduling — not anything that requires live API calls to verify.
