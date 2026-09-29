import { runReport, spCampaignDailyReportRequest } from "../amazon-ads/reports.js";
import { db, initSchema } from "../db/client.js";
import { reportWindows } from "./reportWindows.js";

interface ReportRow {
  date: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales14d: number;
  purchases14d: number;
}

/** Pulls daily SP campaign performance for the last N days (default 7) and upserts it. */
export async function syncReports(daysBack = 7): Promise<number> {
  initSchema();

  const upsert = db.prepare(`
    INSERT INTO sp_campaign_daily_metrics
      (date, campaign_id, campaign_name, impressions, clicks, cost, sales_14d, purchases_14d, synced_at)
    VALUES (@date, @campaignId, @campaignName, @impressions, @clicks, @cost, @sales14d, @purchases14d, @syncedAt)
    ON CONFLICT(date, campaign_id) DO UPDATE SET
      campaign_name = excluded.campaign_name,
      impressions   = excluded.impressions,
      clicks        = excluded.clicks,
      cost          = excluded.cost,
      sales_14d     = excluded.sales_14d,
      purchases_14d = excluded.purchases_14d,
      synced_at     = excluded.synced_at
  `);

  const insertMany = db.transaction((data: ReportRow[], syncedAt: string) => {
    for (const r of data) upsert.run({ ...r, campaignId: String(r.campaignId), syncedAt });
  });

  // One report per <=31-day window (Amazon's limit per v3 report).
  let total = 0;
  for (const w of reportWindows(daysBack)) {
    console.log(`Requesting SP campaign report for ${w.start} to ${w.end}...`);
    const rows = await runReport<ReportRow>(spCampaignDailyReportRequest(w.start, w.end));
    insertMany(rows, new Date().toISOString());
    total += rows.length;
  }

  console.log(`Synced ${total} row(s) of daily campaign performance into ${db.name}.`);
  return total;
}
