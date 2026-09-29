import { db } from "../db/client.js";
import { ASIN_RE } from "./products.js";
import type { Range } from "./queries.js";

/**
 * SB campaign mapper. Sponsored Brands reports don't say which product earned the sale,
 * so each SB campaign is mapped to the ASINs it promotes; product reports split its
 * spend and sales across them by weight. Local data only — nothing is sent to Amazon.
 */

const q = {
  campaigns: db.prepare(`
    SELECT c.campaign_id AS campaignId, c.name, c.state, c.budget, c.budget_type AS budgetType,
           COALESCE(SUM(m.cost), 0) AS cost, COALESCE(SUM(m.sales), 0) AS sales, COALESCE(SUM(m.purchases), 0) AS orders
    FROM sb_campaigns c LEFT JOIN sb_campaign_daily_metrics m ON m.campaign_id = c.campaign_id AND m.date BETWEEN @from AND @to
    WHERE c.state != 'archived' GROUP BY c.campaign_id ORDER BY cost DESC, c.name`),
  mappings: db.prepare(`SELECT campaign_id AS campaignId, asin, weight, updated_by AS updatedBy, updated_at AS updatedAt FROM sb_campaign_products`),
  products: db.prepare(`SELECT asin, title, product_group AS productGroup, sku FROM products WHERE status = 'active' ORDER BY product_group, title`),
  campaignExists: db.prepare(`SELECT 1 FROM sb_campaigns WHERE campaign_id = ?`).pluck(),
  clear: db.prepare(`DELETE FROM sb_campaign_products WHERE campaign_id = ?`),
  insert: db.prepare(`INSERT INTO sb_campaign_products (campaign_id, asin, weight, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`),
};

// Words in SB campaign names that say nothing about the product.
const STOP = new Set(["sb", "sp", "sd", "aravi", "organic", "video", "store", "spotlight", "collection", "product", "products",
  "brand", "brands", "campaign", "headline", "search", "exact", "phrase", "broad", "auto", "manual", "test", "new", "the", "and", "for", "with", "of"]);
const tokens = (s: string | null | undefined) =>
  new Set((s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)));

type Product = { asin: string; title: string | null; productGroup: string | null; sku: string | null };

/**
 * Suggests ASINs for an SB campaign from its name: the products whose title or group share
 * the most meaningful words with it (e.g. "SB | Onion Hair Oil | Video" → the onion products;
 * "SB | Skin Care | …" → the Skin Care group).
 */
export function suggestFor(name: string, products: Product[]): { asin: string; score: number }[] {
  const words = tokens(name);
  if (!words.size) return [];
  const scored = products.map((p) => {
    const t = new Set([...tokens(p.title), ...tokens(p.productGroup)]);
    let score = 0;
    for (const w of words) if (t.has(w)) score++;
    // A whole group name in the campaign ("hair care") is a strong signal.
    if (p.productGroup && name.toLowerCase().includes(p.productGroup.toLowerCase())) score += 2;
    return { asin: p.asin, score };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best < 2) return [];
  return scored.filter((s) => s.score === best).slice(0, 12);
}

export function getSbMapper(range: Range) {
  const products = q.products.all() as Product[];
  const maps = q.mappings.all() as { campaignId: string; asin: string; weight: number; updatedBy: string; updatedAt: string }[];
  const byCampaign = new Map<string, typeof maps>();
  for (const m of maps) (byCampaign.get(m.campaignId) ?? byCampaign.set(m.campaignId, []).get(m.campaignId)!).push(m);
  const campaigns = (q.campaigns.all(range) as { campaignId: string; name: string; cost: number; sales: number }[]).map((c) => ({
    ...c,
    mapped: byCampaign.get(c.campaignId) ?? [],
    suggestions: byCampaign.has(c.campaignId) ? [] : suggestFor(c.name, products),
  }));
  const totalCost = campaigns.reduce((s, c) => s + c.cost, 0);
  const mappedCost = campaigns.filter((c) => c.mapped.length).reduce((s, c) => s + c.cost, 0);
  return { range, campaigns, products, summary: { campaigns: campaigns.length, mapped: campaigns.filter((c) => c.mapped.length).length, totalCost, mappedCost } };
}

export function setMapping(campaignId: string, items: { asin: string; weight?: number }[], user: string): void {
  if (!q.campaignExists.get(campaignId)) throw new Error("Unknown SB campaign — run npm run sync:sb.");
  const clean = new Map<string, number>();
  for (const it of items) {
    const asin = String(it.asin ?? "").trim().toUpperCase();
    if (!ASIN_RE.test(asin)) throw new Error(`"${it.asin}" isn't a valid ASIN.`);
    const w = it.weight == null ? 1 : Number(it.weight);
    if (!(w > 0 && w <= 100)) throw new Error("Weights must be between 0 and 100.");
    clean.set(asin, w);
  }
  if (clean.size > 50) throw new Error("At most 50 products per SB campaign.");
  const now = new Date().toISOString();
  db.transaction(() => {
    q.clear.run(campaignId);
    for (const [asin, w] of clean) q.insert.run(campaignId, asin, w, user, now);
  })();
}
