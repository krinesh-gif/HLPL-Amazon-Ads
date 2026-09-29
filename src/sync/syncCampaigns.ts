import { listSpCampaigns } from "../amazon-ads/campaigns.js";
import { db, initSchema } from "../db/client.js";

export async function syncCampaigns(): Promise<number> {
  initSchema();
  const campaigns = await listSpCampaigns();

  const upsert = db.prepare(`
    INSERT INTO sp_campaigns (campaign_id, name, state, targeting_type, daily_budget, start_date, end_date, synced_at)
    VALUES (@campaignId, @name, @state, @targetingType, @dailyBudget, @startDate, @endDate, @syncedAt)
    ON CONFLICT(campaign_id) DO UPDATE SET
      name = excluded.name,
      state = excluded.state,
      targeting_type = excluded.targeting_type,
      daily_budget = excluded.daily_budget,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      synced_at = excluded.synced_at
  `);

  const syncedAt = new Date().toISOString();
  const insertMany = db.transaction((rows: typeof campaigns) => {
    for (const c of rows) {
      upsert.run({
        campaignId: c.campaignId,
        name: c.name,
        state: c.state,
        targetingType: c.targetingType,
        dailyBudget: c.dailyBudget,
        startDate: c.startDate,
        endDate: c.endDate ?? null,
        syncedAt,
      });
    }
  });
  insertMany(campaigns);

  console.log(`Synced ${campaigns.length} Sponsored Products campaign(s) into ${db.name}.`);
  return campaigns.length;
}
