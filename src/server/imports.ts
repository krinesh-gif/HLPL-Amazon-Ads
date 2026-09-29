import { db } from "../db/client.js";
import { normHeader, parseCsv, parseNumber } from "./csv.js";
import { ASIN_RE } from "./products.js";

/**
 * CSV data imports (Setup → Data import). Two steps, like Nola's uploader:
 *   preview → shows the detected columns, the parsed first rows and every row problem;
 *   commit  → the same parse, written in one transaction and logged in data_imports.
 * Types: product catalogue, Seller Central Business Report (by child ASIN), SB mapping.
 */

export type ImportType = "products" | "business_report" | "sb_mapping";
export interface ImportRequest {
  type: ImportType;
  filename?: string;
  csv: string;
  periodFrom?: string;
  periodTo?: string;
}

interface FieldDef { key: string; label: string; aliases: string[]; required?: boolean }

export const FIELDS: Record<ImportType, FieldDef[]> = {
  products: [
    { key: "asin", label: "ASIN", aliases: ["asin", "childasin"], required: true },
    { key: "sku", label: "SKU", aliases: ["sku", "sellersku", "merchantsku"] },
    { key: "title", label: "Title", aliases: ["title", "productname", "itemname", "name", "producttitle"] },
    { key: "productGroup", label: "Product group", aliases: ["productgroup", "group", "category", "productline", "range"] },
    { key: "mrp", label: "MRP", aliases: ["mrp", "maximumretailprice", "listprice"] },
    { key: "sellingPrice", label: "Selling price", aliases: ["sellingprice", "price", "yourprice", "saleprice"] },
    { key: "unitCost", label: "Unit cost", aliases: ["unitcost", "cost", "cogs", "landedcost", "costprice", "purchaseprice"] },
    { key: "status", label: "Status", aliases: ["status"] },
  ],
  // Seller Central → Reports → Business Reports → "Detail Page Sales and Traffic By Child Item".
  business_report: [
    { key: "asin", label: "(Child) ASIN", aliases: ["childasin", "asin"], required: true },
    { key: "title", label: "Title", aliases: ["title"] },
    { key: "sessions", label: "Sessions", aliases: ["sessionstotal", "sessions"] },
    { key: "pageViews", label: "Page views", aliases: ["pageviewstotal", "pageviews"] },
    { key: "units", label: "Units ordered", aliases: ["unitsordered"] },
    { key: "orderItems", label: "Total order items", aliases: ["totalorderitems"] },
    { key: "sales", label: "Ordered product sales", aliases: ["orderedproductsales"], required: true },
  ],
  sb_mapping: [
    { key: "campaign", label: "Campaign (ID or exact name)", aliases: ["campaignid", "campaign", "campaignname"], required: true },
    { key: "asins", label: "ASIN(s)", aliases: ["asin", "asins", "products"], required: true },
    { key: "weight", label: "Weight", aliases: ["weight", "share"] },
  ],
};

const MAX_CSV_BYTES = 15 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Parsed {
  columns: { field: string; label: string; header: string | null }[];
  rows: Record<string, unknown>[];
  errors: { line: number; message: string }[];
  total: number;
}

function parse(req: ImportRequest): Parsed {
  if (!FIELDS[req.type]) throw new Error("Unknown import type.");
  if (typeof req.csv !== "string" || !req.csv.trim()) throw new Error("The file is empty.");
  if (req.csv.length > MAX_CSV_BYTES) throw new Error("File is over 15 MB — split it and import in parts.");
  const table = parseCsv(req.csv);
  if (table.length < 2) throw new Error("Need a header row and at least one data row.");
  const headers = table[0].map((h) => h.trim());
  const norm = headers.map(normHeader);
  const defs = FIELDS[req.type];
  const index: Record<string, number> = {};
  const columns = defs.map((f) => {
    const i = f.aliases.map((a) => norm.indexOf(a)).find((i) => i >= 0) ?? -1;
    if (i >= 0) index[f.key] = i;
    return { field: f.key, label: f.label, header: i >= 0 ? headers[i] : null };
  });
  const missing = defs.filter((f) => f.required && index[f.key] == null);
  if (missing.length) {
    throw new Error(`Couldn't find column${missing.length > 1 ? "s" : ""}: ${missing.map((m) => m.label).join(", ")}. ` +
      `Headers in the file: ${headers.slice(0, 12).join(", ")}${headers.length > 12 ? "…" : ""}`);
  }

  const errors: Parsed["errors"] = [];
  const rows: Record<string, unknown>[] = [];
  const cell = (r: string[], k: string) => (index[k] == null ? undefined : (r[index[k]] ?? "").trim());
  const num = (r: string[], k: string, line: number, label: string, int = false) => {
    const v = parseNumber(cell(r, k));
    if (v != null && (Number.isNaN(v) || v < 0)) { errors.push({ line, message: `${label} "${cell(r, k)}" isn't a number` }); return undefined; }
    return v == null ? null : int ? Math.round(v) : v;
  };
  const seen = new Set<string>();

  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (req.type === "sb_mapping") {
      const campaign = cell(r, "campaign") ?? "";
      const asins = (cell(r, "asins") ?? "").toUpperCase().split(/[\s|;,]+/).filter(Boolean);
      const bad = asins.filter((a) => !ASIN_RE.test(a));
      if (!campaign) return void errors.push({ line, message: "Campaign is empty" });
      if (!asins.length || bad.length) return void errors.push({ line, message: bad.length ? `Invalid ASIN ${bad[0]}` : "No ASINs" });
      const weight = num(r, "weight", line, "Weight");
      if (weight === undefined) return;
      rows.push({ campaign, asins, weight: weight ?? 1 });
      return;
    }
    const asin = (cell(r, "asin") ?? "").toUpperCase();
    if (!ASIN_RE.test(asin)) return void errors.push({ line, message: asin ? `"${asin}" isn't a valid ASIN` : "ASIN is empty" });
    if (seen.has(asin)) return void errors.push({ line, message: `${asin} appears more than once — only the first row is used` });
    seen.add(asin);
    if (req.type === "products") {
      const out: Record<string, unknown> = { asin, sku: cell(r, "sku") || null, title: cell(r, "title") || null,
        productGroup: cell(r, "productGroup") || null, status: (cell(r, "status") ?? "").toLowerCase() === "inactive" ? "inactive" : cell(r, "status") ? "active" : null };
      for (const [k, label] of [["mrp", "MRP"], ["sellingPrice", "Selling price"], ["unitCost", "Unit cost"]] as const) {
        const v = num(r, k, line, label);
        if (v === undefined) return;
        out[k] = v;
      }
      if (out.sellingPrice != null && out.unitCost != null && (out.unitCost as number) > (out.sellingPrice as number) * 3) {
        errors.push({ line, message: `${asin}: unit cost is over 3× the selling price — check the columns` });
      }
      rows.push(out);
    } else {
      const out: Record<string, unknown> = { asin, title: cell(r, "title") || null };
      for (const [k, label, int] of [["sessions", "Sessions", true], ["pageViews", "Page views", true], ["units", "Units", true], ["orderItems", "Order items", true], ["sales", "Sales", false]] as const) {
        const v = num(r, k, line, label, int);
        if (v === undefined) return;
        out[k] = v;
      }
      rows.push(out);
    }
  });
  return { columns, rows, errors, total: table.length - 1 };
}

const q = {
  overlaps: db.prepare(`SELECT DISTINCT period_from AS "from", period_to AS "to" FROM business_report
    WHERE period_from <= @to AND period_to >= @from AND NOT (period_from = @from AND period_to = @to)`),
  deletePeriod: db.prepare(`DELETE FROM business_report WHERE period_from = ? AND period_to = ?`),
  insertBiz: db.prepare(`INSERT INTO business_report (asin, period_from, period_to, sessions, page_views, units, order_items, sales, import_id)
    VALUES (@asin, @from, @to, @sessions, @pageViews, @units, @orderItems, @sales, @importId)`),
  fillTitle: db.prepare(`INSERT INTO products (asin, title, source, updated_at) VALUES (?, ?, 'import', ?)
    ON CONFLICT(asin) DO UPDATE SET title = COALESCE(products.title, excluded.title)`),
  upsertProduct: db.prepare(`
    INSERT INTO products (asin, sku, title, product_group, mrp, selling_price, unit_cost, status, source, updated_at)
    VALUES (@asin, @sku, @title, @productGroup, @mrp, @sellingPrice, @unitCost, COALESCE(@status, 'active'), 'import', @now)
    ON CONFLICT(asin) DO UPDATE SET
      sku = COALESCE(excluded.sku, products.sku), title = COALESCE(excluded.title, products.title),
      product_group = COALESCE(excluded.product_group, products.product_group), mrp = COALESCE(excluded.mrp, products.mrp),
      selling_price = COALESCE(excluded.selling_price, products.selling_price), unit_cost = COALESCE(excluded.unit_cost, products.unit_cost),
      status = COALESCE(@status, products.status), updated_at = excluded.updated_at`),
  sbByIdOrName: db.prepare(`SELECT campaign_id FROM sb_campaigns WHERE campaign_id = ? OR lower(name) = lower(?) LIMIT 1`).pluck(),
  clearMap: db.prepare(`DELETE FROM sb_campaign_products WHERE campaign_id = ?`),
  insertMap: db.prepare(`INSERT OR REPLACE INTO sb_campaign_products (campaign_id, asin, weight, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`),
  logImport: db.prepare(`INSERT INTO data_imports (type, filename, period_from, period_to, rows_total, rows_imported, rows_skipped, imported_by, imported_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?) RETURNING id`),
  finishImport: db.prepare(`UPDATE data_imports SET rows_imported = ?, rows_skipped = ? WHERE id = ?`),
  history: db.prepare(`SELECT id, type, filename, period_from AS periodFrom, period_to AS periodTo, rows_total AS rowsTotal,
    rows_imported AS rowsImported, rows_skipped AS rowsSkipped, imported_by AS importedBy, imported_at AS importedAt,
    (SELECT COUNT(*) FROM business_report b WHERE b.import_id = data_imports.id) AS liveRows
    FROM data_imports ORDER BY id DESC LIMIT 50`),
  getImport: db.prepare(`SELECT type FROM data_imports WHERE id = ?`).pluck(),
  deleteBizImport: db.prepare(`DELETE FROM business_report WHERE import_id = ?`),
};

function checkPeriod(req: ImportRequest): { from: string; to: string } {
  const from = req.periodFrom ?? "", to = req.periodTo ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    throw new Error("Pick the date range the Business Report covers (the From/To you chose in Seller Central).");
  }
  const clash = q.overlaps.all({ from, to }) as { from: string; to: string }[];
  if (clash.length) {
    throw new Error(`That range overlaps an earlier import (${clash[0].from} → ${clash[0].to}); sales would be double-counted. ` +
      `Delete that import first, or import the same exact range to replace it.`);
  }
  return { from, to };
}

export function previewImport(req: ImportRequest) {
  const p = parse(req);
  let note: string | null = null;
  if (req.type === "business_report") {
    const { from, to } = checkPeriod(req);
    note = `Covers ${from} → ${to}. Re-importing this exact range replaces it.`;
  }
  if (req.type === "sb_mapping") {
    const unknown = p.rows.filter((r) => !q.sbByIdOrName.get(r.campaign, r.campaign));
    for (const r of unknown.slice(0, 20)) p.errors.push({ line: 0, message: `SB campaign "${r.campaign}" not found (sync SB first)` });
  }
  return { columns: p.columns, sample: p.rows.slice(0, 15), total: p.total, valid: p.rows.length, errors: p.errors.slice(0, 100), errorCount: p.errors.length, note };
}

export function commitImport(req: ImportRequest, user: string) {
  const p = parse(req);
  const period = req.type === "business_report" ? checkPeriod(req) : null;
  const now = new Date().toISOString();
  let imported = 0;
  const id = db.transaction(() => {
    const importId = (q.logImport.get(req.type, req.filename?.slice(0, 200) ?? null, period?.from ?? null, period?.to ?? null, p.total, user, now) as { id: number }).id;
    if (req.type === "products") {
      for (const r of p.rows) { q.upsertProduct.run({ ...r, now }); imported++; }
    } else if (req.type === "business_report") {
      q.deletePeriod.run(period!.from, period!.to);
      for (const r of p.rows) {
        q.insertBiz.run({ ...r, from: period!.from, to: period!.to, importId });
        if (r.title) q.fillTitle.run(r.asin, r.title, now);
        imported++;
      }
    } else {
      const byCampaign = new Map<string, { asin: string; weight: number }[]>();
      for (const r of p.rows) {
        const cid = q.sbByIdOrName.get(r.campaign, r.campaign) as string | undefined;
        if (!cid) continue;
        const list = byCampaign.get(cid) ?? byCampaign.set(cid, []).get(cid)!;
        for (const a of r.asins as string[]) list.push({ asin: a, weight: r.weight as number });
        imported++;
      }
      for (const [cid, list] of byCampaign) {
        q.clearMap.run(cid);
        for (const m of list) q.insertMap.run(cid, m.asin, m.weight, user, now);
      }
    }
    q.finishImport.run(imported, p.total - imported, importId);
    return importId;
  })();
  return { importId: id, imported, skipped: p.total - imported };
}

export const importHistory = () => q.history.all();

/** Removes a Business Report import's rows (e.g. to re-import a corrected file for an overlapping range). */
export function deleteImport(id: number): void {
  if (q.getImport.get(id) !== "business_report") throw new Error("Only Business Report imports can be removed (catalogue and mapping imports are edited in place).");
  q.deleteBizImport.run(id);
}

/** CSV template headers per import type (for the "download template" links). */
export function templateFor(type: ImportType): string {
  const example: Record<ImportType, string> = {
    products: "ASIN,SKU,Title,Product group,MRP,Selling price,Unit cost,Status\nB0XXXXXXX1,ARV-ONION-200,Aravi Onion Hair Oil 200ml,Hair Care,499,449,120,active\n",
    business_report: "(Parent) ASIN,(Child) ASIN,Title,Sessions - Total,Page Views - Total,Units Ordered,Ordered Product Sales,Total Order Items\nB0XXXXXXX0,B0XXXXXXX1,Aravi Onion Hair Oil 200ml,1200,1650,85,\"₹38,165.00\",82\n",
    sb_mapping: "Campaign,ASINs,Weight\nSB | Onion Hair Oil | Video,B0XXXXXXX1|B0XXXXXXX2,1\n",
  };
  return example[type];
}
