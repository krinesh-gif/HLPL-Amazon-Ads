import { useState } from "react";
import type { PageProps } from "../App";
import { SetupNav } from "../components/SetupNav";
import { Card, Empty, Skeleton } from "../components/Ui";
import { send, useApi } from "../lib/api";
import { fmtCount, fmtDateTime, fmtDay } from "../lib/format";

type ImportType = "business_report" | "products" | "sb_mapping";

const TYPES: { key: ImportType; title: string; what: string; how: React.ReactNode }[] = [
  {
    key: "business_report",
    title: "Business Report",
    what: "Total sales, units and sessions per ASIN (ads + organic) — needed for TACOS.",
    how: <>Seller Central → <strong>Reports → Business Reports → Detail Page Sales and Traffic By Child Item</strong>. Pick a date range, download CSV, and enter the <em>same</em> range below. Weekly or monthly files work; ranges mustn't overlap.</>,
  },
  {
    key: "products",
    title: "Product catalogue",
    what: "ASIN, SKU, title, product group, MRP, selling price and unit cost.",
    how: <>Any CSV with an ASIN column — e.g. an export from Unicommerce or your own sheet. Blank cells leave existing values unchanged.</>,
  },
  {
    key: "sb_mapping",
    title: "SB campaign mapping",
    what: "Which products each Sponsored Brands campaign promotes.",
    how: <>One row per campaign: campaign ID or exact name, ASINs separated by <code>|</code>, optional weight. Replaces that campaign's current mapping.</>,
  },
];

interface Preview {
  columns: { field: string; label: string; header: string | null }[];
  sample: Record<string, unknown>[];
  total: number;
  valid: number;
  errors: { line: number; message: string }[];
  errorCount: number;
  note: string | null;
}
interface History {
  history: { id: number; type: ImportType; filename: string | null; periodFrom: string | null; periodTo: string | null; rowsTotal: number; rowsImported: number; rowsSkipped: number; importedBy: string; importedAt: string; liveRows: number }[];
}

const cellText = (v: unknown) => (v == null ? "" : Array.isArray(v) ? v.join(" | ") : typeof v === "number" ? v.toLocaleString("en-IN") : String(v));

export function DataImportPage({ range }: PageProps) {
  const [type, setType] = useState<ImportType>("business_report");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [periodFrom, setFrom] = useState("");
  const [periodTo, setTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useApi<History>("/api/imports");
  const def = TYPES.find((t) => t.key === type)!;

  const body = () => ({ type, filename: file?.name, csv: file?.text, periodFrom: periodFrom || undefined, periodTo: periodTo || undefined });
  const reset = () => { setPreview(null); setError(null); setDone(null); };

  async function onFile(f: File | undefined) {
    reset();
    if (!f) return setFile(null);
    if (f.size > 15 * 1024 * 1024) return setError("File is over 15 MB — split it and import in parts.");
    setFile({ name: f.name, text: await f.text() });
  }
  async function runPreview() {
    setBusy(true); setError(null); setDone(null);
    try { setPreview(await send<Preview>("POST", "/api/imports/preview", body())); }
    catch (e) { setPreview(null); setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true); setError(null);
    try {
      const r = await send<{ imported: number; skipped: number }>("POST", "/api/imports", body());
      setDone(`Imported ${fmtCount(r.imported)} row${r.imported === 1 ? "" : "s"}${r.skipped ? `, skipped ${fmtCount(r.skipped)} with problems` : ""}.`);
      setPreview(null);
      setFile(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    if (!confirm("Remove this Business Report's data? The dashboard stops counting its sales. You can re-import the file.")) return;
    try { await send("DELETE", `/api/imports/${id}`); } catch (e) { alert((e as Error).message); }
  }

  const ready = !!file && (type !== "business_report" || (periodFrom && periodTo));

  return (
    <div className="stack">
      <SetupNav current="/setup/import" range={range} />
      <div className="import-types" role="radiogroup" aria-label="What are you importing?">
        {TYPES.map((t) => (
          <button key={t.key} role="radio" aria-checked={type === t.key} className={`card import-type ${type === t.key ? "selected" : ""}`}
            onClick={() => { setType(t.key); reset(); }}>
            <strong>{t.title}</strong>
            <span className="muted small">{t.what}</span>
          </button>
        ))}
      </div>

      <Card title={`Import: ${def.title}`} actions={<a className="link" href={`/api/imports/template/${type}`}>Download template</a>}>
        <p className="muted small how">{def.how}</p>
        <div className="import-form">
          {type === "business_report" && (
            <>
              <label className="field">Report from<input type="date" value={periodFrom} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} /></label>
              <label className="field">Report to<input type="date" value={periodTo} min={periodFrom} onChange={(e) => { setTo(e.target.value); setPreview(null); }} /></label>
            </>
          )}
          <label className="field file-field">CSV file
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <button className="btn" disabled={!ready || busy} onClick={runPreview}>{busy && !preview ? "Checking…" : "Preview"}</button>
        </div>
        {error && <p className="warn" role="alert">{error}</p>}
        {done && <p className="flash-inline" role="status">{done}</p>}

        {preview && (
          <div className="preview">
            <div className="preview-stats">
              <span><strong>{fmtCount(preview.total)}</strong> rows in file</span>
              <span className="good-text"><strong>{fmtCount(preview.valid)}</strong> ready to import</span>
              {preview.errorCount > 0 && <span className="warn-text"><strong>{fmtCount(preview.errorCount)}</strong> with problems (skipped)</span>}
              {preview.note && <span className="muted small">{preview.note}</span>}
            </div>
            <div className="colmap">
              {preview.columns.map((c) => (
                <span key={c.field} className={`pill ${c.header ? "st-deployed" : ""}`} title={c.header ? `Column "${c.header}"` : "Not in the file"}>
                  {c.header ? "✓" : "–"} {c.label}{c.header && c.header.toLowerCase() !== c.label.toLowerCase() ? ` ← ${c.header}` : ""}
                </span>
              ))}
            </div>
            {preview.errors.length > 0 && (
              <details className="errors" open={preview.valid === 0}>
                <summary className="warn-text small">Show problems</summary>
                <ul className="small">
                  {preview.errors.map((e, i) => <li key={i}>{e.line ? `Row ${e.line}: ` : ""}{e.message}</li>)}
                  {preview.errorCount > preview.errors.length && <li>…and {preview.errorCount - preview.errors.length} more</li>}
                </ul>
              </details>
            )}
            {preview.sample.length > 0 && (
              <div className="table-wrap">
                <table className="table compact">
                  <thead><tr>{Object.keys(preview.sample[0]).map((k) => <th key={k}>{preview.columns.find((c) => c.field === k)?.label ?? k}</th>)}</tr></thead>
                  <tbody>
                    {preview.sample.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{cellText(v)}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
              <button className="btn primary" disabled={!preview.valid || busy} onClick={commit}>{busy ? "Importing…" : `Import ${fmtCount(preview.valid)} rows`}</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Import history">
        {!history.data ? <Skeleton h={120} /> : history.data.history.length === 0 ? <Empty title="Nothing imported yet" /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>When</th><th>Type</th><th className="hide-sm">File</th><th>Covers</th><th className="num">Rows</th><th className="hide-sm">By</th><th /></tr></thead>
              <tbody>
                {history.data.history.map((h) => (
                  <tr key={h.id}>
                    <td>{fmtDateTime(h.importedAt)}</td>
                    <td>{TYPES.find((t) => t.key === h.type)?.title ?? h.type}</td>
                    <td className="hide-sm muted small truncate">{h.filename ?? "—"}</td>
                    <td>{h.periodFrom ? `${fmtDay(h.periodFrom)} – ${fmtDay(h.periodTo!, true)}` : "—"}</td>
                    <td className="num">{fmtCount(h.rowsImported)}{h.rowsSkipped ? <span className="muted small"> (+{h.rowsSkipped} skipped)</span> : null}</td>
                    <td className="hide-sm">{h.importedBy}</td>
                    <td>{h.type === "business_report" && (h.liveRows > 0
                      ? <button className="linkish" onClick={() => remove(h.id)}>remove</button>
                      : <span className="muted small">removed</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
