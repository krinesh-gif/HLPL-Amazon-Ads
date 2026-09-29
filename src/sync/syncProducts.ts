import { listSpProductAds } from "../amazon-ads/productAds.js";
import { runReport, spAdvertisedProductDailyReportRequest } from "../amazon-ads/reports.js";
import { db, initSchema } from "../db/client.js";
import { reportWindows } from "./reportWindows.js";

interface Row {
  date: string;
  campaignId: string;
  adGroupId: string;
  advertisedAsin: string;
  advertisedSku?: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales14d: number;
  purchases14d: number;
}

/**
 * SP product ads (which ASIN each ad group advertises) + daily performance per advertised
 * ASIN. New ASINs are added to the product catalogue; existing catalogue edits are kept.
 */
export async function syncProducts(daysBack = 14): Promise<number> {
  initSchema();
  const ads = await listSpProductAds();
  const now = new Date().toISOString();
  const upsertAd = db.prepare(`
    INSERT INTO sp_product_ads (ad_id, campaign_id, ad_group_id, asin, sku, state, synced_at)
    VALUES (@adId, @campaignId, @adGroupId, @asin, @sku, @state, @syncedAt)
    ON CONFLICT(ad_id) DO UPDATE SET campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id,
      asin = excluded.asin, sku = excluded.sku, state = excluded.state, synced_at = excluded.synced_at`);
  // Only fills gaps — never overwrites titles, groups or costs someone entered.
  const discover = db.prepare(`
    INSERT INTO products (asin, sku, source, updated_at) VALUES (?, ?, 'sync', ?)
    ON CONFLICT(asin) DO UPDATE SET sku = COALESCE(products.sku, excluded.sku)`);
  db.transaction(() => {
    for (const a of ads) {
      const asin = a.asin?.toUpperCase() ?? null;
      upsertAd.run({ ...a, adId: String(a.adId), campaignId: String(a.campaignId), adGroupId: String(a.adGroupId),
        asin, sku: a.sku ?? null, state: a.state.toLowerCase(), syncedAt: now });
      if (asin) discover.run(asin, a.sku ?? null, now);
    }
  })();

  const upsert = db.prepare(`
    INSERT INTO sp_advertised_product_daily (date, campaign_id, ad_group_id, asin, sku, impressions, clicks, cost, sales_14d, purchases_14d, synced_at)
    VALUES (@date, @campaignId, @adGroupId, @asin, @sku, @impressions, @clicks, @cost, @sales14d, @purchases14d, @syncedAt)
    ON CONFLICT(date, ad_group_id, asin) DO UPDATE SET campaign_id = excluded.campaign_id, sku = excluded.sku,
      impressions = excluded.impressions, clicks = excluded.clicks, cost = excluded.cost,
      sales_14d = excluded.sales_14d, purchases_14d = excluded.purchases_14d, synced_at = excluded.synced_at`);
  let rows = 0;
  for (const w of reportWindows(daysBack)) {
    console.log(`Advertised product report ${w.start} to ${w.end}...`);
    const data = await runReport<Row>(spAdvertisedProductDailyReportRequest(w.start, w.end));
    const at = new Date().toISOString();
    db.transaction(() => {
      for (const r of data) {
        upsert.run({ ...r, campaignId: String(r.campaignId), adGroupId: String(r.adGroupId),
          asin: r.advertisedAsin.toUpperCase(), sku: r.advertisedSku ?? null, syncedAt: at });
      }
    })();
    rows += data.length;
  }
  console.log(`Synced ${ads.length} product ad(s) and ${rows} daily product row(s) into ${db.name}.`);
  return ads.length + rows;
}
