import { runReport, sbCampaignDailyReportRequest } from "../amazon-ads/reports.js";
import { listSbCampaigns } from "../amazon-ads/sbCampaigns.js";
import { db, initSchema } from "../db/client.js";
import { reportWindows } from "./reportWindows.js";

interface Row {
  date: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  purchases: number;
}

/** Sponsored Brands: current campaign settings + daily performance for the last N days. */
export async function syncSponsoredBrands(daysBack = 14): Promise<number> {
  initSchema();
  const campaigns = await listSbCampaigns();
  const syncedAt = new Date().toISOString();
  const upsertCampaign = db.prepare(`
    INSERT INTO sb_campaigns (campaign_id, name, state, budget, budget_type, cost_type, start_date, end_date, synced_at)
    VALUES (@campaignId, @name, @state, @budget, @budgetType, @costType, @startDate, @endDate, @syncedAt)
    ON CONFLICT(campaign_id) DO UPDATE SET
      name = excluded.name, state = excluded.state, budget = excluded.budget, budget_type = excluded.budget_type,
      cost_type = excluded.cost_type, start_date = excluded.start_date, end_date = excluded.end_date,
      synced_at = excluded.synced_at`);
  db.transaction(() => {
    for (const c of campaigns) {
      upsertCampaign.run({
        campaignId: String(c.campaignId), name: c.name, state: c.state.toLowerCase(), budget: c.budget ?? null,
        budgetType: c.budgetType?.toLowerCase() ?? null, costType: c.costType?.toLowerCase() ?? null,
        startDate: c.startDate ?? null, endDate: c.endDate ?? null, syncedAt,
      });
    }
  })();

  const upsert = db.prepare(`
    INSERT INTO sb_campaign_daily_metrics (date, campaign_id, campaign_name, impressions, clicks, cost, sales, purchases, synced_at)
    VALUES (@date, @campaignId, @campaignName, @impressions, @clicks, @cost, @sales, @purchases, @syncedAt)
    ON CONFLICT(date, campaign_id) DO UPDATE SET
      campaign_name = excluded.campaign_name, impressions = excluded.impressions, clicks = excluded.clicks,
      cost = excluded.cost, sales = excluded.sales, purchases = excluded.purchases, synced_at = excluded.synced_at`);
  let rows = 0;
  for (const w of reportWindows(daysBack)) {
    console.log(`SB campaign report ${w.start} to ${w.end}...`);
    const data = await runReport<Row>(sbCampaignDailyReportRequest(w.start, w.end));
    const at = new Date().toISOString();
    db.transaction(() => {
      for (const r of data) upsert.run({ ...r, campaignId: String(r.campaignId), syncedAt: at });
    })();
    rows += data.length;
  }
  console.log(`Synced ${campaigns.length} SB campaign(s) and ${rows} daily row(s) into ${db.name}.`);
  return campaigns.length + rows;
}
