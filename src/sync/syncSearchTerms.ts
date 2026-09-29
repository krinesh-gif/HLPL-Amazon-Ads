import { runReport, spSearchTermDailyReportRequest } from "../amazon-ads/reports.js";
import { db, initSchema } from "../db/client.js";
import { reportWindows } from "./reportWindows.js";

interface Row {
  date: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  keyword?: string;
  targeting?: string;
  matchType?: string;
  searchTerm: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales14d: number;
  purchases14d: number;
}

/** Daily search-term performance for the last N days (default 14). */
export async function syncSearchTerms(daysBack = 14): Promise<number> {
  initSchema();
  const upsert = db.prepare(`
    INSERT INTO sp_search_term_daily_metrics
      (date, search_term, target_id, campaign_id, ad_group_id, targeting, match_type,
       impressions, clicks, cost, sales_14d, purchases_14d, synced_at)
    VALUES (@date, @searchTerm, @keywordId, @campaignId, @adGroupId, @targetingText, @matchType,
       @impressions, @clicks, @cost, @sales14d, @purchases14d, @syncedAt)
    ON CONFLICT(date, target_id, search_term) DO UPDATE SET
      campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id, targeting = excluded.targeting,
      match_type = excluded.match_type, impressions = excluded.impressions, clicks = excluded.clicks,
      cost = excluded.cost, sales_14d = excluded.sales_14d, purchases_14d = excluded.purchases_14d,
      synced_at = excluded.synced_at`);

  let total = 0;
  for (const w of reportWindows(daysBack)) {
    console.log(`Search term report ${w.start} to ${w.end}...`);
    const rows = await runReport<Row>(spSearchTermDailyReportRequest(w.start, w.end));
    const syncedAt = new Date().toISOString();
    db.transaction(() => {
      for (const r of rows) {
        upsert.run({
          ...r,
          searchTerm: r.searchTerm.toLowerCase(),
          keywordId: String(r.keywordId), campaignId: String(r.campaignId), adGroupId: String(r.adGroupId),
          targetingText: r.keyword || r.targeting || null, matchType: r.matchType?.toLowerCase() ?? null, syncedAt,
        });
      }
    })();
    total += rows.length;
  }
  console.log(`Synced ${total} row(s) of daily search-term performance into ${db.name}.`);
  return total;
}
