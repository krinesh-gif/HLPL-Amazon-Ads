import { useDeferredValue, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { DataTable, nextSort, type Column } from "../components/DataTable";
import { SetupNav } from "../components/SetupNav";
import { Card, Empty, ErrorBox, Skeleton } from "../components/Ui";
import { qs, send, useApi } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import { fmtCount, fmtINR, fmtPct } from "../lib/format";
import { href, navigate } from "../lib/router";
import type { ProductRow, ProductsResponse } from "../lib/types";

const ratio = (a: number, b: number | null) => (b ? a / b : null);

function sortValue(r: ProductRow, key: string): number | string | null {
  switch (key) {
    case "title": return (r.title ?? r.asin).toLowerCase();
    case "group": return (r.productGroup ?? "~").toLowerCase();
    case "acos": return ratio(r.adCost, r.adSales);
    case "tacos": return ratio(r.adCost, r.totalSales);
    case "be": return r.breakEvenAcos;
    case "price": return r.sellingPrice;
    case "cost": return r.unitCost;
    case "totalSales": return r.totalSales;
    case "units": return r.units;
    case "adSales": return r.adSales;
    default: return r.adCost;
  }
}

type Draft = { asin: string; sku: string; title: string; productGroup: string; mrp: string; sellingPrice: string; unitCost: string; status: string };
const toDraft = (r?: ProductRow): Draft => ({
  asin: r?.asin ?? "", sku: r?.sku ?? "", title: r?.title ?? "", productGroup: r?.productGroup ?? "",
  mrp: r?.mrp?.toString() ?? "", sellingPrice: r?.sellingPrice?.toString() ?? "", unitCost: r?.unitCost?.toString() ?? "", status: r?.status ?? "active",
});

function ProductEditor({ draft, isNew, groups, onClose }: { draft: Draft; isNew: boolean; groups: string[]; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = { ...d, mrp: d.mrp || null, sellingPrice: d.sellingPrice || null, unitCost: d.unitCost || null };
    try {
      if (isNew) await send("POST", "/api/products", body);
      else await send("PUT", `/api/products/${encodeURIComponent(d.asin)}`, body);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form className="modal card editor" role="dialog" aria-modal="true" aria-labelledby="pe-title" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 id="pe-title">{isNew ? "Add product" : "Edit product"}</h2>
        <div className="form-grid">
          <label className="field">ASIN<input value={d.asin} onChange={set("asin")} disabled={!isNew} required pattern="[Bb]0[0-9A-Za-z]{8}" placeholder="B0XXXXXXXX" /></label>
          <label className="field">SKU<input value={d.sku} onChange={set("sku")} /></label>
          <label className="field span-2">Title<input value={d.title} onChange={set("title")} /></label>
          <label className="field">Product group
            <input value={d.productGroup} onChange={set("productGroup")} list="product-groups" placeholder="e.g. Hair Care" />
            <datalist id="product-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </label>
          <label className="field">Status
            <select value={d.status} onChange={set("status")}><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </label>
          <label className="field">MRP ₹<input type="number" step="0.01" min={0} value={d.mrp} onChange={set("mrp")} /></label>
          <label className="field">Selling price ₹<input type="number" step="0.01" min={0} value={d.sellingPrice} onChange={set("sellingPrice")} /></label>
          <label className="field">Unit cost ₹ <span className="muted small">(landed cost / COGS)</span><input type="number" step="0.01" min={0} value={d.unitCost} onChange={set("unitCost")} /></label>
        </div>
        {error && <p className="warn small" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

export function ProductsPage({ range, params }: PageProps) {
  const { data, error } = useApi<ProductsResponse>(`/api/products?${qs({ from: range.from, to: range.to })}`);
  const [search, setSearch] = useState("");
  const needle = useDeferredValue(search.trim().toLowerCase());
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const group = params.get("group") ?? "";
  const show = params.get("show") ?? "active";
  const sort = params.get("sort") ?? "adCost";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    p.set("from", range.from); p.set("to", range.to);
    for (const [k, v] of Object.entries(patch)) v == null || v === "" ? p.delete(k) : p.set(k, v);
    navigate("/setup/products", p, true);
  };

  const groups = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.productGroup).filter(Boolean) as string[])].sort(), [data]);
  const missing = (r: ProductRow) => !r.inCatalogue || !r.title || r.unitCost == null || r.sellingPrice == null || !r.productGroup;
  const rows = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return (data?.rows ?? [])
      .filter((r) => show === "all" || (show === "missing" ? missing(r) : r.status === "active"))
      .filter((r) => !group || r.productGroup === group)
      .filter((r) => !needle || [r.asin, r.sku, r.title, r.productGroup].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const x = sortValue(a, sort), y = sortValue(b, sort);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * d;
      });
  }, [data, show, group, needle, sort, dir]);
  const totals = rows.reduce((t, r) => ({ ad: t.ad + r.adCost, adSales: t.adSales + r.adSales, total: t.total + (r.totalSales ?? 0) }), { ad: 0, adSales: 0, total: 0 });

  if (error) return <ErrorBox message={error} />;
  const missingCount = (data?.rows ?? []).filter(missing).length;
  const cover = data?.businessReport;

  const columns: Column<ProductRow>[] = [
    {
      key: "title", label: "Product",
      render: (r) => (
        <span className="term-cell">
          <strong>{r.title ?? <span className="muted">No title</span>}</strong>
          {!r.inCatalogue && <span className="pill st-staged" title="Seen in ads data but not in the catalogue yet">new</span>}
          {r.status === "inactive" && <span className="pill">inactive</span>}
          <span className="muted small block">{r.asin}{r.sku ? ` · ${r.sku}` : ""}</span>
        </span>
      ),
      footer: `${rows.length} products`,
    },
    { key: "group", label: "Group", hideSm: true, render: (r) => r.productGroup ?? <span className="muted">—</span> },
    { key: "price", label: "Price", num: true, hideSm: true, render: (r) => r.sellingPrice == null ? <span className="muted">—</span> : <>{fmtINR(r.sellingPrice)}{r.mrp && r.mrp !== r.sellingPrice ? <span className="muted small block">MRP {fmtINR(r.mrp)}</span> : null}</> },
    { key: "cost", label: "Unit cost", num: true, hideSm: true, render: (r) => r.unitCost == null ? <span className="warn-text">missing</span> : fmtINR(r.unitCost) },
    { key: "be", label: "Break-even ACOS", num: true, render: (r) => r.breakEvenAcos == null ? <span className="muted">—</span> : <span className={r.breakEvenAcos < 0.15 ? "over" : ""}>{fmtPct(r.breakEvenAcos, 0)}</span> },
    {
      key: "adCost", label: "Ad spend", num: true,
      render: (r) => <span title={`SP ${fmtINR(r.spCost)} + SB ${fmtINR(r.sbCost)}`}>{fmtINR(r.adCost)}{r.sbCost > 0 && <span className="muted small block">incl. SB {fmtINR(r.sbCost)}</span>}</span>,
      footer: fmtINR(totals.ad),
    },
    { key: "adSales", label: "Ad sales", num: true, hideSm: true, render: (r) => fmtINR(r.adSales), footer: fmtINR(totals.adSales) },
    {
      key: "acos", label: "ACOS", num: true,
      render: (r) => {
        const a = ratio(r.adCost, r.adSales);
        const losing = a == null ? r.adCost > 0 : r.breakEvenAcos != null && a > r.breakEvenAcos;
        return <span className={losing ? "over" : ""} title={losing ? (a == null ? "Ad spend with no ad sales" : "Above break-even: ads on this product lose money") : undefined}>{fmtPct(a)}</span>;
      },
    },
    { key: "totalSales", label: "Total sales", num: true, render: (r) => r.totalSales == null ? <span className="muted">—</span> : fmtINR(r.totalSales), footer: fmtINR(totals.total) },
    { key: "tacos", label: "TACOS", num: true, render: (r) => fmtPct(ratio(r.adCost, r.totalSales)), footer: fmtPct(ratio(totals.ad, totals.total)) },
    { key: "units", label: "Units", num: true, hideSm: true, render: (r) => fmtCount(r.units) },
    { key: "edit", label: "", sortable: false, render: (r) => <button className="linkish" onClick={() => setEditing({ draft: toDraft(r), isNew: false })}>{r.inCatalogue ? "edit" : "add"}</button> },
  ];

  function exportCsv() {
    downloadCsv(`aravi-product-catalogue.csv`,
      ["ASIN", "SKU", "Title", "Product group", "MRP", "Selling price", "Unit cost", "Status", "Ad spend", "Ad sales", "Total sales", "TACOS", "Break-even ACOS"],
      rows.map((r) => [r.asin, r.sku, r.title, r.productGroup, r.mrp, r.sellingPrice, r.unitCost, r.status,
        r.adCost.toFixed(2), r.adSales.toFixed(2), r.totalSales?.toFixed(2), r.totalSales ? (r.adCost / r.totalSales).toFixed(4) : "", r.breakEvenAcos?.toFixed(4)]));
  }

  return (
    <div className="stack">
      <SetupNav current="/setup/products" range={range} />
      {data && (
        <div className="setup-summary">
          <div className="stat"><span className="muted small">Products</span><strong>{data.rows.filter((r) => r.inCatalogue).length}</strong></div>
          <div className={`stat ${missingCount ? "attention" : ""}`}>
            <span className="muted small">Missing info</span><strong>{missingCount}</strong>
            {missingCount > 0 && <button className="linkish" onClick={() => setParams({ show: "missing" })}>show</button>}
          </div>
          <div className={`stat ${cover && cover.coveredDays < cover.rangeDays ? "attention" : ""}`}>
            <span className="muted small">Business Reports</span>
            <strong>{cover ? `${cover.coveredDays}/${cover.rangeDays} days` : "—"}</strong>
            {cover && cover.coveredDays < cover.rangeDays && <a className="link small" href={href("/setup/import", range)}>import →</a>}
          </div>
          <div className={`stat ${data.unattributed.sb.cost > 0 ? "attention" : ""}`}>
            <span className="muted small">SB spend not mapped</span><strong>{fmtINR(data.unattributed.sb.cost)}</strong>
            {data.unattributed.sb.cost > 0 && <a className="link small" href={href("/setup/sb-mapper", range)}>map →</a>}
          </div>
        </div>
      )}
      <Card>
        <div className="toolbar">
          <input className="search" type="search" placeholder="Search ASIN, SKU or title…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          <select value={group} onChange={(e) => setParams({ group: e.target.value })} aria-label="Product group">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Show">
            {[["active", "Active"], ["missing", "Missing info"], ["all", "All"]].map(([k, l]) => (
              <button key={k} className={show === k ? "active" : ""} onClick={() => setParams({ show: k === "active" ? null : k })}>{l}</button>
            ))}
          </div>
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
          <button className="btn primary" onClick={() => setEditing({ draft: toDraft(), isNew: true })}>Add product</button>
        </div>
        <form className="rules muted small" onSubmit={(e) => {
          e.preventDefault();
          if (fee != null) send("POST", "/api/settings/fees", { feePct: Number(fee) / 100 }).then(() => setFee(null)).catch((err) => alert(err.message));
        }}>
          <span>
            <strong>Break-even ACOS</strong> = (price − unit cost − Amazon fees) ÷ price, with Amazon fees (referral + closing + shipping) at
            <input type="number" min={0} max={90} step={0.5} value={fee ?? (data ? String(Math.round(data.feePct * 1000) / 10) : "")} onChange={(e) => setFee(e.target.value)} aria-label="Amazon fees percent" />%
            of price{fee != null && <button className="btn small-btn primary" type="submit">Save</button>}.
            ACOS above it means ads on that product lose money.
          </span>
          <span><strong>TACOS</strong> = ad spend ÷ total sales (from Business Reports). Ad spend = SP ads for the ASIN + SB campaigns mapped to it.
            {data && data.unattributed.sd.cost > 0 && <> SD spend ({fmtINR(data.unattributed.sd.cost)}) isn't attributed to products yet.</>}</span>
        </form>
      </Card>
      <Card>
        {!data ? <Skeleton h={400} /> : rows.length === 0 ? (
          <Empty title={data.rows.length ? "No products match" : "No products yet"}>
            {data.rows.length ? "Try another filter." : <>Run <code>npm run sync:products</code> to discover the ASINs in your ads, or import a catalogue on <a className="link" href={href("/setup/import", range)}>Data import</a>.</>}
          </Empty>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.asin} sort={sort} dir={dir}
            onSort={(k) => setParams(nextSort(sort, dir, k, ["title", "group"]))} footer />
        )}
      </Card>
      {editing && <ProductEditor draft={editing.draft} isNew={editing.isNew} groups={groups} onClose={() => setEditing(null)} />}
    </div>
  );
}
