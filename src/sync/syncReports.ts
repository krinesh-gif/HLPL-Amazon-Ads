import {
  downloadReport,
  requestReport,
  spCampaignDailyReportRequest,
  waitForReport,
} from "../amazon-ads/reports.js";
import { db, initSchema } from "../db/client.js";

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

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - daysBack);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  console.log(`Requesting SP campaign report for ${fmt(startDate)} to ${fmt(endDate)}...`);
  const reportId = await requestReport(spCampaignDailyReportRequest(fmt(startDate), fmt(endDate)));
  console.log(`Report requested (id=${reportId}), waiting for it to finish...`);
  const url = await waitForReport(reportId);
  const rows = await downloadReport<ReportRow>(url);

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

  const syncedAt = new Date().toISOString();
  const insertMany = db.transaction((data: ReportRow[]) => {
    for (const r of data) upsert.run({ ...r, syncedAt });
  });
  insertMany(rows);

  console.log(`Synced ${rows.length} row(s) of daily campaign performance into ${db.name}.`);
  return rows.length;
}
