import { db } from "../db/client.js";
import type { Range } from "./queries.js";

/**
 * Product catalogue + product-level performance.
 *  - Ad spend/sales per ASIN = SP advertised-product report + SB campaigns split by the
 *    SB campaign mapper (weights). SD isn't attributed to products yet.
 *  - Total sales/sessions/units come from imported Business Reports, prorated by days
 *    when an imported period only partly overlaps the selected range.
 */

export const ASIN_RE = /^B0[0-9A-Z]{8}$/;
const DEFAULT_FEE_PCT = 0.3;

const q = {
  products: db.prepare(`SELECT asin, sku, title, product_group AS productGroup, mrp, selling_price AS sellingPrice,
    unit_cost AS unitCost, status, source, updated_at AS updatedAt FROM products`),
  sp: db.prepare(`
    SELECT asin, SUM(cost) AS cost, SUM(sales_14d) AS sales, SUM(purchases_14d) AS orders, SUM(clicks) AS clicks, SUM(impressions) AS impressions
    FROM sp_advertised_product_daily WHERE date BETWEEN @from AND @to GROUP BY asin`),
  sb: db.prepare(`
    WITH w AS (
      SELECT campaign_id, asin, weight / SUM(weight) OVER (PARTITION BY campaign_id) AS share FROM sb_campaign_products
    ), m AS (
      SELECT campaign_id, SUM(cost) AS cost, SUM(sales) AS sales, SUM(purchases) AS orders
      FROM sb_campaign_daily_metrics WHERE date BETWEEN @from AND @to GROUP BY campaign_id
    )
    SELECT w.asin, SUM(m.cost * w.share) AS cost, SUM(m.sales * w.share) AS sales, SUM(m.orders * w.share) AS orders
    FROM w JOIN m ON m.campaign_id = w.campaign_id GROUP BY w.asin`),
  sbUnmapped: db.prepare(`
    SELECT COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(sales), 0) AS sales FROM sb_campaign_daily_metrics
    WHERE date BETWEEN @from AND @to AND campaign_id NOT IN (SELECT campaign_id FROM sb_campaign_products)`),
  sdTotal: db.prepare(`SELECT COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(sales), 0) AS sales FROM sd_campaign_daily_metrics WHERE date BETWEEN @from AND @to`),
  business: db.prepare(`
    SELECT asin,
      SUM(sales * f) AS sales, SUM(units * f) AS units, SUM(sessions * f) AS sessions, SUM(page_views * f) AS pageViews
    FROM (
      SELECT *, (julianday(MIN(period_to, @to)) - julianday(MAX(period_from, @from)) + 1)
               / (julianday(period_to) - julianday(period_from) + 1) AS f
      FROM business_report WHERE period_from <= @to AND period_to >= @from
    ) GROUP BY asin`),
  periods: db.prepare(`SELECT DISTINCT period_from AS "from", period_to AS "to" FROM business_report WHERE period_from <= @to AND period_to >= @from`),
  feePct: db.prepare(`SELECT value FROM meta WHERE key = 'amazon_fee_pct'`).pluck(),
  setFee: db.prepare(`INSERT INTO meta (key, value) VALUES ('amazon_fee_pct', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
  get: db.prepare(`SELECT asin FROM products WHERE asin = ?`),
  update: db.prepare(`UPDATE products SET sku = @sku, title = @title, product_group = @productGroup, mrp = @mrp,
    selling_price = @sellingPrice, unit_cost = @unitCost, status = @status, updated_at = @updatedAt WHERE asin = @asin`),
  insert: db.prepare(`INSERT INTO products (asin, sku, title, product_group, mrp, selling_price, unit_cost, status, source, updated_at)
    VALUES (@asin, @sku, @title, @productGroup, @mrp, @sellingPrice, @unitCost, @status, 'manual', @updatedAt)`),
};

interface CatalogueRow {
  asin: string;
  sku: string | null;
  title: string | null;
  productGroup: string | null;
  mrp: number | null;
  sellingPrice: number | null;
  unitCost: number | null;
  status: string;
  source: string;
  updatedAt: string | null;
}

export function feePct(): number {
  const v = Number(q.feePct.get());
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_FEE_PCT;
}
export function setFeePct(v: number): void {
  if (!(v >= 0 && v < 0.9)) throw new Error("Fees must be between 0% and 90%.");
  q.setFee.run(String(v));
}

/** Days in `range` covered by at least one imported Business Report period. */
function coveredDays(range: Range, periods: { from: string; to: string }[]): number {
  const day = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86_400_000);
  const lo = day(range.from), hi = day(range.to);
  const covered = new Set<number>();
  for (const p of periods) for (let d = Math.max(lo, day(p.from)); d <= Math.min(hi, day(p.to)); d++) covered.add(d);
  return covered.size;
}

export function getProducts(range: Range) {
  const byAsin = <T extends { asin: string }>(rows: T[]) => new Map(rows.map((r) => [r.asin, r]));
  type M = { asin: string; cost: number; sales: number; orders: number; clicks?: number; impressions?: number };
  const sp = byAsin(q.sp.all(range) as M[]);
  const sb = byAsin(q.sb.all(range) as M[]);
  const biz = byAsin(q.business.all(range) as { asin: string; sales: number; units: number; sessions: number; pageViews: number }[]);
  const catalogue = q.products.all() as CatalogueRow[];
  const fee = feePct();

  const asins = new Set<string>([...catalogue.map((p) => p.asin), ...sp.keys(), ...sb.keys(), ...biz.keys()]);
  const cat = new Map(catalogue.map((p) => [p.asin, p]));
  const rows = [...asins].map((asin) => {
    const p: CatalogueRow = cat.get(asin) ?? { asin, sku: null, title: null, productGroup: null, mrp: null, sellingPrice: null, unitCost: null, status: "active", source: "unlisted", updatedAt: null };
    const s = sp.get(asin), b = sb.get(asin), z = biz.get(asin);
    const adCost = (s?.cost ?? 0) + (b?.cost ?? 0);
    const adSales = (s?.sales ?? 0) + (b?.sales ?? 0);
    const price = p.sellingPrice, cost = p.unitCost;
    // Margin left for advertising per ₹ of sales, after product cost and Amazon fees.
    const breakEvenAcos = price && cost != null ? (price - cost - price * fee) / price : null;
    return {
      ...p,
      inCatalogue: cat.has(asin),
      spCost: s?.cost ?? 0, spSales: s?.sales ?? 0, sbCost: b?.cost ?? 0, sbSales: b?.sales ?? 0,
      adCost, adSales, adOrders: (s?.orders ?? 0) + (b?.orders ?? 0), clicks: s?.clicks ?? 0,
      totalSales: z?.sales ?? null, units: z?.units ?? null, sessions: z?.sessions ?? null,
      breakEvenAcos,
    };
  });
  rows.sort((a, b) => b.adCost - a.adCost || String(a.title ?? a.asin).localeCompare(String(b.title ?? b.asin)));

  const periods = q.periods.all(range) as { from: string; to: string }[];
  const rangeDays = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  return {
    range,
    feePct: fee,
    rows,
    unattributed: { sb: q.sbUnmapped.get(range), sd: q.sdTotal.get(range) },
    businessReport: { coveredDays: coveredDays(range, periods), rangeDays },
  };
}

export interface ProductInput {
  asin: string;
  sku?: string | null;
  title?: string | null;
  productGroup?: string | null;
  mrp?: number | null;
  sellingPrice?: number | null;
  unitCost?: number | null;
  status?: string;
}

function clean(p: ProductInput) {
  const asin = String(p.asin ?? "").trim().toUpperCase();
  if (!ASIN_RE.test(asin)) throw new Error("ASIN must look like B0XXXXXXXX (10 characters).");
  const money = (v: unknown, label: string) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new Error(`${label} must be a positive amount.`);
    return Math.round(n * 100) / 100;
  };
  const text = (v: unknown, max: number) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
  const status = p.status === "inactive" ? "inactive" : "active";
  return {
    asin, sku: text(p.sku, 60), title: text(p.title, 250), productGroup: text(p.productGroup, 80),
    mrp: money(p.mrp, "MRP"), sellingPrice: money(p.sellingPrice, "Selling price"), unitCost: money(p.unitCost, "Unit cost"),
    status, updatedAt: new Date().toISOString(),
  };
}

export function saveProduct(p: ProductInput, mode: "create" | "update"): void {
  const row = clean(p);
  const exists = !!q.get.get(row.asin);
  if (mode === "create" && exists) throw new Error("That ASIN is already in the catalogue.");
  if (mode === "update" && !exists) {
    q.insert.run(row); // an "unlisted" ASIN (seen in ads data) being added on first edit
    return;
  }
  (mode === "create" ? q.insert : q.update).run(row);
}
