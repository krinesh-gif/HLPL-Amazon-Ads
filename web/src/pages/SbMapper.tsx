import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { SetupNav } from "../components/SetupNav";
import { Card, Empty, ErrorBox, Skeleton, StatePill } from "../components/Ui";
import { qs, send, useApi } from "../lib/api";
import { fmtINR, fmtPct } from "../lib/format";
import { href } from "../lib/router";
import type { SbMapperCampaign, SbMapperResponse } from "../lib/types";

type Item = { asin: string; weight: number };

function CampaignMapper({ c, products, onSaved }: { c: SbMapperCampaign; products: SbMapperResponse["products"]; onSaved: (msg: string) => void }) {
  const saved: Item[] = c.mapped.map((m) => ({ asin: m.asin, weight: m.weight }));
  const [items, setItems] = useState<Item[]>(saved);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setItems(c.mapped.map((m) => ({ asin: m.asin, weight: m.weight }))), [c.mapped]);

  const title = (asin: string) => products.find((p) => p.asin === asin)?.title ?? asin;
  const dirty = JSON.stringify(items) !== JSON.stringify(saved);
  const totalW = items.reduce((s, i) => s + i.weight, 0);
  const acos = c.sales ? c.cost / c.sales : null;

  async function save(next = items) {
    setError(null);
    try {
      await send("PUT", `/api/sb-mapper/${encodeURIComponent(c.campaignId)}`, { products: next });
      onSaved(`Saved mapping for "${c.name}".`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const add = (asin: string) => {
    if (!asin || items.some((i) => i.asin === asin)) return;
    setItems([...items, { asin, weight: 1 }]);
    setAdding("");
  };

  return (
    <section className={`card mapper ${items.length ? "" : "unmapped"}`}>
      <header className="mapper-head">
        <div>
          <h3>{c.name}</h3>
          <p className="muted small"><StatePill state={c.state} /> · {fmtINR(c.cost)} spend · {fmtINR(c.sales)} sales · ACOS {fmtPct(acos)}</p>
        </div>
        {!saved.length && <span className="pill st-staged">not mapped</span>}
      </header>

      {items.length > 0 && (
        <ul className="map-list">
          {items.map((it) => (
            <li key={it.asin}>
              <span className="map-title">{title(it.asin)} <span className="muted small">{it.asin}</span></span>
              <label className="small muted">weight
                <input type="number" min={0.1} max={100} step={0.1} value={it.weight} aria-label={`Weight for ${it.asin}`}
                  onChange={(e) => setItems(items.map((x) => (x.asin === it.asin ? { ...x, weight: Number(e.target.value) || 0 } : x)))} />
              </label>
              <span className="share small">{fmtPct(totalW ? it.weight / totalW : null, 0)}</span>
              <button className="linkish" onClick={() => setItems(items.filter((x) => x.asin !== it.asin))} aria-label={`Remove ${it.asin}`}>remove</button>
            </li>
          ))}
        </ul>
      )}

      {c.suggestions.length > 0 && !items.length && (
        <div className="suggest-box">
          <span className="small"><strong>Suggested from the campaign name:</strong> {c.suggestions.map((s) => title(s.asin)).join(", ")}</span>
          <button className="btn small-btn" onClick={() => setItems(c.suggestions.map((s) => ({ asin: s.asin, weight: 1 })))}>Use suggestion</button>
        </div>
      )}

      <div className="mapper-actions">
        <select value={adding} onChange={(e) => add(e.target.value)} aria-label={`Add a product to ${c.name}`}>
          <option value="">+ Add product…</option>
          {[...new Set(products.map((p) => p.productGroup ?? "Other"))].map((g) => (
            <optgroup key={g} label={g}>
              {products.filter((p) => (p.productGroup ?? "Other") === g && !items.some((i) => i.asin === p.asin)).map((p) => (
                <option key={p.asin} value={p.asin}>{p.title ?? p.asin}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="spacer" />
        {dirty && <button className="linkish" onClick={() => setItems(saved)}>discard</button>}
        <button className="btn small-btn primary" disabled={!dirty || items.some((i) => !(i.weight > 0))} onClick={() => save()}>Save</button>
      </div>
      {error && <p className="warn small" role="alert">{error}</p>}
    </section>
  );
}

export function SbMapperPage({ range }: PageProps) {
  const { data, error } = useApi<SbMapperResponse>(`/api/sb-mapper?${qs({ from: range.from, to: range.to })}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unmapped">("all");
  const list = useMemo(() => (data?.campaigns ?? []).filter((c) => filter === "all" || !c.mapped.length), [data, filter]);
  const pending = (data?.campaigns ?? []).filter((c) => !c.mapped.length && c.suggestions.length);

  async function applyAll() {
    if (!confirm(`Map ${pending.length} campaign${pending.length === 1 ? "" : "s"} using the suggestions? You can edit them afterwards.`)) return;
    for (const c of pending) await send("PUT", `/api/sb-mapper/${encodeURIComponent(c.campaignId)}`, { products: c.suggestions.map((s) => ({ asin: s.asin, weight: 1 })) });
    setMsg(`Mapped ${pending.length} campaigns from suggestions.`);
  }

  if (error) return <ErrorBox message={error} />;
  const s = data?.summary;
  return (
    <div className="stack">
      <SetupNav current="/setup/sb-mapper" range={range} />
      <Card>
        <p className="muted">
          Sponsored Brands reports don't say which product made the sale. Map each SB campaign to the products it promotes and its
          spend and sales are split across them by weight (equal by default) in the <a className="link" href={href("/setup/products", range)}>product catalogue</a>.
          This only affects reporting here — nothing is changed in Amazon.
        </p>
        {s && (
          <div className="mapper-summary">
            <span><strong>{s.mapped}</strong> of {s.campaigns} SB campaigns mapped</span>
            <span className="share-bar wide" title={fmtPct(s.totalCost ? s.mappedCost / s.totalCost : null)}>
              <span style={{ width: `${s.totalCost ? (s.mappedCost / s.totalCost) * 100 : 0}%`, background: "var(--series-2)" }} />
            </span>
            <span className="muted small">{fmtPct(s.totalCost ? s.mappedCost / s.totalCost : null, 0)} of SB spend ({fmtINR(s.mappedCost)} of {fmtINR(s.totalCost)}) attributed</span>
          </div>
        )}
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Show">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
            <button className={filter === "unmapped" ? "active" : ""} onClick={() => setFilter("unmapped")}>Not mapped</button>
          </div>
          {pending.length > 0 && <button className="btn primary" onClick={applyAll}>Use {pending.length} suggestion{pending.length === 1 ? "" : "s"}</button>}
        </div>
        {msg && <p className="flash-inline small" role="status">{msg}</p>}
      </Card>
      {!data ? <Skeleton h={300} /> : data.campaigns.length === 0 ? (
        <Card><Empty title="No Sponsored Brands campaigns">Run <code>npm run sync:sb</code> once the Ads API is connected.</Empty></Card>
      ) : data.products.length === 0 ? (
        <Card><Empty title="Add products first">The mapper needs a product catalogue — see <a className="link" href={href("/setup/products", range)}>Product catalogue</a>.</Empty></Card>
      ) : (
        <div className="mapper-grid">
          {list.map((c) => <CampaignMapper key={c.campaignId} c={c} products={data.products} onSaved={setMsg} />)}
        </div>
      )}
    </div>
  );
}
