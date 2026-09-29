import { runReport, sdCampaignDailyReportRequest } from "../amazon-ads/reports.js";
import { listSdCampaigns, SD_TACTIC_LABEL } from "../amazon-ads/sdCampaigns.js";
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

/** Sponsored Display: current campaign settings + daily performance for the last N days. */
export async function syncSponsoredDisplay(daysBack = 14): Promise<number> {
  initSchema();
  const campaigns = await listSdCampaigns();
  const syncedAt = new Date().toISOString();
  const upsertCampaign = db.prepare(`
    INSERT INTO sd_campaigns (campaign_id, name, state, tactic, budget, budget_type, cost_type, start_date, end_date, synced_at)
    VALUES (@campaignId, @name, @state, @tactic, @budget, @budgetType, @costType, @startDate, @endDate, @syncedAt)
    ON CONFLICT(campaign_id) DO UPDATE SET
      name = excluded.name, state = excluded.state, tactic = excluded.tactic, budget = excluded.budget,
      budget_type = excluded.budget_type, cost_type = excluded.cost_type, start_date = excluded.start_date,
      end_date = excluded.end_date, synced_at = excluded.synced_at`);
  // SD dates come as YYYYMMDD; store ISO like everything else.
  const isoDate = (d?: string) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d ?? null);
  db.transaction(() => {
    for (const c of campaigns) {
      upsertCampaign.run({
        campaignId: String(c.campaignId), name: c.name, state: c.state.toLowerCase(),
        tactic: SD_TACTIC_LABEL[c.tactic] ?? c.tactic ?? null, budget: c.budget ?? null,
        budgetType: c.budgetType?.toLowerCase() ?? null, costType: c.costType?.toLowerCase() ?? null,
        startDate: isoDate(c.startDate), endDate: isoDate(c.endDate), syncedAt,
      });
    }
  })();

  const upsert = db.prepare(`
    INSERT INTO sd_campaign_daily_metrics (date, campaign_id, campaign_name, impressions, clicks, cost, sales, purchases, synced_at)
    VALUES (@date, @campaignId, @campaignName, @impressions, @clicks, @cost, @sales, @purchases, @syncedAt)
    ON CONFLICT(date, campaign_id) DO UPDATE SET
      campaign_name = excluded.campaign_name, impressions = excluded.impressions, clicks = excluded.clicks,
      cost = excluded.cost, sales = excluded.sales, purchases = excluded.purchases, synced_at = excluded.synced_at`);
  let rows = 0;
  for (const w of reportWindows(daysBack)) {
    console.log(`SD campaign report ${w.start} to ${w.end}...`);
    const data = await runReport<Row>(sdCampaignDailyReportRequest(w.start, w.end));
    const at = new Date().toISOString();
    db.transaction(() => {
      for (const r of data) upsert.run({ ...r, campaignId: String(r.campaignId), syncedAt: at });
    })();
    rows += data.length;
  }
  console.log(`Synced ${campaigns.length} SD campaign(s) and ${rows} daily row(s) into ${db.name}.`);
  return campaigns.length + rows;
}
