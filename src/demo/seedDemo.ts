import { db, initSchema } from "../db/client.js";
import { buildDemoTargets, splitDay } from "./demoTargeting.js";

/**
 * Fills the DB with realistic-looking but entirely FAKE Sponsored Products data, so the
 * dashboard can be used and reviewed before Amazon Ads API access is approved.
 * Marks the DB with meta.data_source = 'demo' — the UI shows a permanent banner for it.
 *
 * Refuses to touch a DB that already holds real synced data unless --force is passed.
 */

// Deterministic PRNG so the demo looks the same on every machine.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoCampaign {
  name: string;
  targeting: "manual" | "auto";
  budget: number; // INR / day
  cpc: number; // INR
  ctr: number;
  cvr: number;
  aov: number; // INR
  state?: "enabled" | "paused";
  pausedDaysAgo?: number;
}

const CAMPAIGNS: DemoCampaign[] = [
  { name: "SP | Onion Hair Oil | Exact", targeting: "manual", budget: 3000, cpc: 9.5, ctr: 0.0062, cvr: 0.084, aov: 449 },
  { name: "SP | Onion Hair Oil | Auto", targeting: "auto", budget: 1500, cpc: 7.2, ctr: 0.0041, cvr: 0.054, aov: 449 },
  { name: "SP | Rosemary Hair Oil | Exact", targeting: "manual", budget: 2500, cpc: 11.4, ctr: 0.0055, cvr: 0.072, aov: 499 },
  { name: "SP | Rosemary Hair Oil | Broad", targeting: "manual", budget: 1200, cpc: 8.8, ctr: 0.0034, cvr: 0.036, aov: 499 },
  { name: "SP | Vitamin C Serum | Exact", targeting: "manual", budget: 2000, cpc: 14.5, ctr: 0.0048, cvr: 0.06, aov: 599 },
  { name: "SP | Vitamin C Serum | Auto", targeting: "auto", budget: 800, cpc: 10.1, ctr: 0.0031, cvr: 0.03, aov: 599 },
  { name: "SP | Niacinamide Serum | Phrase", targeting: "manual", budget: 1000, cpc: 12.9, ctr: 0.0039, cvr: 0.042, aov: 549 },
  { name: "SP | Kumkumadi Oil | Exact", targeting: "manual", budget: 1200, cpc: 13.2, ctr: 0.0044, cvr: 0.054, aov: 799 },
  { name: "SP | Aloe Vera Gel | Auto", targeting: "auto", budget: 600, cpc: 5.1, ctr: 0.0052, cvr: 0.066, aov: 299 },
  { name: "SP | Ubtan Face Wash | Exact", targeting: "manual", budget: 900, cpc: 6.8, ctr: 0.0058, cvr: 0.072, aov: 349 },
  { name: "SP | Red Onion Shampoo | Phrase", targeting: "manual", budget: 1100, cpc: 8.1, ctr: 0.0043, cvr: 0.048, aov: 399 },
  { name: "SP | Sunscreen SPF 50 | Exact", targeting: "manual", budget: 1400, cpc: 15.8, ctr: 0.0036, cvr: 0.024, aov: 449 },
  { name: "SP | Brand Defense | Aravi", targeting: "manual", budget: 700, cpc: 3.4, ctr: 0.021, cvr: 0.144, aov: 520 },
  { name: "SP | Competitor ASIN | Hair Oils", targeting: "manual", budget: 1000, cpc: 10.5, ctr: 0.0021, cvr: 0.018, aov: 470 },
  { name: "SP | Bhringraj Oil | Test", targeting: "manual", budget: 500, cpc: 9.0, ctr: 0.0025, cvr: 0, aov: 399 },
  { name: "SP | Hair Care Combo | Auto", targeting: "auto", budget: 800, cpc: 8.4, ctr: 0.0037, cvr: 0.048, aov: 899, state: "paused", pausedDaysAgo: 20 },
];

const DAYS = 180;
/** Amazon only keeps search-term data for a limited window, so the demo mirrors that. */
const SEARCH_TERM_DAYS = 90;

export function seedDemo({ force = false } = {}): void {
  initSchema();
  const existingSource = (db.prepare(`SELECT value FROM meta WHERE key = 'data_source'`).get() as
    | { value: string }
    | undefined)?.value;
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM sp_campaign_daily_metrics`).get() as { n: number };
  if (n > 0 && existingSource !== "demo" && !force) {
    throw new Error(
      `${db.name} already contains ${n} rows of real synced data — refusing to overwrite it with demo data. ` +
        `Point DB_PATH at a different file (npm run demo does this for you), or pass --force.`
    );
  }

  const rand = mulberry32(20260929);
  const noise = (spread: number) => 1 + (rand() * 2 - 1) * spread;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const syncedAt = new Date().toISOString();

  const insertCampaign = db.prepare(`
    INSERT INTO sp_campaigns (campaign_id, name, state, targeting_type, daily_budget, start_date, end_date, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`);
  const insertAdGroup = db.prepare(`INSERT INTO sp_ad_groups VALUES (?, ?, ?, ?, ?, ?)`);
  const insertTarget = db.prepare(`INSERT INTO sp_targets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertNegative = db.prepare(`INSERT INTO sp_negative_keywords VALUES (?, ?, ?, ?, ?, ?)`);
  const insertTargetMetric = db.prepare(`
    INSERT INTO sp_target_daily_metrics
      (date, target_id, campaign_id, ad_group_id, text, match_type, impressions, clicks, cost, sales_14d, purchases_14d, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertTermMetric = db.prepare(`
    INSERT INTO sp_search_term_daily_metrics
      (date, search_term, target_id, campaign_id, ad_group_id, targeting, match_type, impressions, clicks, cost, sales_14d, purchases_14d, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertMetric = db.prepare(`
    INSERT INTO sp_campaign_daily_metrics
      (date, campaign_id, campaign_name, impressions, clicks, cost, sales_14d, purchases_14d, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    db.exec(`DELETE FROM sp_campaign_daily_metrics; DELETE FROM sp_campaigns; DELETE FROM sync_runs; DELETE FROM profiles;
      DELETE FROM sp_ad_groups; DELETE FROM sp_targets; DELETE FROM sp_negative_keywords;
      DELETE FROM sp_target_daily_metrics; DELETE FROM sp_search_term_daily_metrics;`);
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('data_source', 'demo')`).run();
    db.prepare(
      `INSERT INTO profiles VALUES ('0000000000000', 'IN', 'INR', 'Aravi Organic (DEMO)', 'seller', ?)`
    ).run(syncedAt);

    CAMPAIGNS.forEach((c, i) => {
      const id = String(300000000000000 + i * 7919);
      const start = new Date(today.getTime() - (DAYS + 30) * 86_400_000);
      insertCampaign.run(id, c.name, c.state ?? "enabled", c.targeting, c.budget, start.toISOString().slice(0, 10), syncedAt);

      const adGroupId = String(500000000000000 + i * 7919);
      insertAdGroup.run(adGroupId, id, `${c.name.split("|")[1]?.trim() ?? c.name} – main`, c.state ?? "enabled", Math.round(c.cpc * 1.2 * 100) / 100, syncedAt);
      const targets = buildDemoTargets(c.name, c.cpc, rand);
      for (const t of targets) insertTarget.run(t.id, t.kind, id, adGroupId, t.text, t.matchType, "enabled", t.bid, syncedAt);
      // One junk term already negated in some ad groups, so the "already negated" logic has something to find.
      if (i % 3 === 0) insertNegative.run(`demo-neg-${i}`, id, adGroupId, "coconut oil", "negative_exact", syncedAt);
      if (i % 4 === 1) insertNegative.run(`demo-negc-${i}`, id, null, "mustard oil", "negative_phrase", syncedAt);

      for (let d = DAYS; d >= 1; d--) {
        if (c.pausedDaysAgo && d < c.pausedDaysAgo) continue;
        const date = new Date(today.getTime() - d * 86_400_000);
        const dow = date.getUTCDay();
        const weekly = dow === 0 || dow === 6 ? 1.12 : dow === 3 ? 0.94 : 1;
        const trend = 0.8 + 0.4 * ((DAYS - d) / DAYS); // account growing over the period
        // A festive-sale bump roughly 5–3 weeks ago.
        const sale = d >= 20 && d <= 34 ? 1.45 : 1;
        const demand = weekly * trend * sale * noise(0.18);

        const cpc = c.cpc * (sale > 1 ? 1.2 : 1) * noise(0.12);
        let clicks = Math.max(0, Math.round((c.budget / c.cpc) * 0.7 * demand * noise(0.2)));
        let cost = clicks * cpc;
        if (cost > c.budget) {
          // Budget cap: Amazon stops serving once the daily budget is spent.
          clicks = Math.floor(c.budget / cpc);
          cost = clicks * cpc;
        }
        const impressions = Math.round((clicks / c.ctr) * noise(0.15));
        let orders = 0;
        for (let k = 0; k < clicks; k++) if (rand() < c.cvr * (sale > 1 ? 1.15 : 1)) orders++;
        const sales = orders * c.aov * noise(0.08);

        const day = date.toISOString().slice(0, 10);
        const totals = { impressions, clicks, cost: Math.round(cost * 100) / 100, sales: Math.round(sales * 100) / 100, orders };
        insertMetric.run(day, id, c.name, impressions, clicks, totals.cost, totals.sales, orders, syncedAt);

        splitDay(totals, targets, rand).forEach((tt, ti) => {
          const t = targets[ti];
          if (tt.impressions === 0) return;
          insertTargetMetric.run(day, t.id, id, adGroupId, t.text, t.matchType, tt.impressions, tt.clicks, tt.cost, tt.sales, tt.orders, syncedAt);
          if (d > SEARCH_TERM_DAYS) return;
          splitDay(tt, t.terms, rand).forEach((st, si) => {
            if (st.impressions === 0) return;
            insertTermMetric.run(day, t.terms[si].term, t.id, id, adGroupId, t.text, t.matchType, st.impressions, st.clicks, st.cost, st.sales, st.orders, syncedAt);
          });
        });
      }
    });

    // Fake a history of daily syncs so the Sync status screen has something to show.
    const insertRun = db.prepare(
      `INSERT INTO sync_runs (job, started_at, finished_at, status, rows_synced, detail) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (let d = 14; d >= 0; d--) {
      const t = new Date(today.getTime() - d * 86_400_000 + 6 * 3_600_000);
      const done = new Date(t.getTime() + 95_000);
      insertRun.run("campaigns", t.toISOString(), new Date(t.getTime() + 4000).toISOString(), "success", CAMPAIGNS.length, "demo");
      insertRun.run("keywords", t.toISOString(), new Date(t.getTime() + 9000).toISOString(), "success", 60, "demo");
      insertRun.run("targeting", t.toISOString(), done.toISOString(), "success", 900, "demo · last 14 days");
      insertRun.run("search-terms", t.toISOString(), done.toISOString(), "success", 4200, "demo · last 14 days");
      if (d === 9) insertRun.run("reports", t.toISOString(), done.toISOString(), "failed", null, "demo: report did not finish within 300000ms");
      else insertRun.run("reports", t.toISOString(), done.toISOString(), "success", CAMPAIGNS.length * 7, "demo · last 7 days");
    }
  })();

  console.log(`Seeded DEMO data (${CAMPAIGNS.length} campaigns × ${DAYS} days) into ${db.name}.`);
}
