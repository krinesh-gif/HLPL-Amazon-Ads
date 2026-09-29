import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { CampaignSelect } from "../components/CampaignSelect";
import { DataTable, nextSort, type Column } from "../components/DataTable";
import { Flash, HarvestForm, stageWithFlash } from "../components/StageControls";
import { Card, Empty, ErrorBox, Skeleton } from "../components/Ui";
import { qs, useApi } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import { fmtCount, fmtDay, fmtINR, fmtPct } from "../lib/format";
import { usePref } from "../lib/prefs";
import { unstage, useQueue } from "../lib/queue";
import { href, navigate } from "../lib/router";
import type { SearchTermRow, SearchTermsResponse } from "../lib/types";

const PAGE = 100;
const VIEWS = [
  { key: "all", label: "All terms" },
  { key: "harvest", label: "Harvest" },
  { key: "negate", label: "Negate" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function Source({ r }: { r: SearchTermRow }) {
  const kind = r.sourceKind === "keyword" ? r.matchType ?? "keyword" : r.sourceKind ?? "target";
  return (
    <span className="source">
      <span className={`pill kind-${r.sourceKind ?? "unknown"}`}>{kind}</span>{" "}
      <span className="source-text">{r.sourceText ?? "—"}</span>
      <span className="muted small block truncate-sm">
        {r.campaignName ?? r.campaignId}{r.adGroupName ? ` › ${r.adGroupName}` : ""}
        {r.sourceCount > 1 ? ` · +${r.sourceCount - 1} more source${r.sourceCount > 2 ? "s" : ""}` : ""}
      </span>
    </span>
  );
}

export function SearchTermsPage({ range, meta, targetAcos, params }: PageProps) {
  const view = (params.get("view") as View) || "all";
  const campaignId = params.get("campaignId") ?? "";
  const sort = params.get("sort") ?? "cost";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(0, Number(params.get("page")) || 0);
  const [minClicks, setMinClicks] = usePref("negateMinClicks", 10);
  const [minOrders, setMinOrders] = usePref("harvestMinOrders", 2);
  const queue = useQueue();
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [harvesting, setHarvesting] = useState<string | null>(null);

  // Search is sent to the server, debounced so typing doesn't fire a request per key.
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    p.set("from", range.from);
    p.set("to", range.to);
    for (const [k, v] of Object.entries(patch)) v == null || v === "" ? p.delete(k) : p.set(k, v);
    if (!("page" in patch)) p.delete("page");
    navigate("/search-terms", p, true);
  };
  useEffect(() => {
    if ((params.get("q") ?? "") !== q) setParams({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = {
    from: range.from, to: range.to, view, sort, dir, q,
    targetAcos: String(targetAcos), minClicks: String(minClicks), minOrders: String(minOrders),
    ...(campaignId ? { campaignId } : {}),
  };
  const { data, error } = useApi<SearchTermsResponse>(`/api/search-terms?${qs({ ...query, limit: String(PAGE), offset: String(page * PAGE) })}`);

  if (error) return <ErrorBox message={error} />;
  if (meta.counts.searchTermRows === 0) {
    return (
      <Card>
        <Empty title="No search-term data yet">
          Run <code>npm run sync:search-terms -- 60</code> once Amazon Ads API access is set up (or <code>npm run demo</code> to look around).
        </Empty>
      </Card>
    );
  }

  const negatable = (data?.rows ?? []).filter((r) => r.action?.type === "negate" && !queue.byKey.has(`negative:${r.adGroupId}:${r.searchTerm}`));
  const coverageStart = meta.searchTerms.minDate;
  const partial = coverageStart && range.from < coverageStart;

  const columns: Column<SearchTermRow>[] = [
    {
      key: "searchTerm", label: "Search term",
      render: (r) => (
        <span className="term-cell">
          <strong>{r.searchTerm}</strong>
          {r.isAsin && <span className="pill">ASIN</span>}
          {r.hasExactKeyword && <span className="pill" title="Already an enabled exact keyword / ASIN target somewhere">targeted</span>}
          {r.negated && <span className="pill" title="Already negated in this ad group or campaign">negated</span>}
          <span className="muted small block show-sm">via {r.sourceKind === "keyword" ? r.matchType : r.sourceKind} {r.sourceText}</span>
        </span>
      ),
    },
    { key: "source", label: view === "harvest" ? "Top source" : "Matched via", sortable: false, hideSm: true, render: (r) => <Source r={r} /> },
    {
      key: "action", label: "Suggestion", sortable: false,
      render: (r) => {
        if (!r.action) return <span className="muted">—</span>;
        const staged = r.action.type === "negate"
          ? queue.byKey.get(`negative:${r.adGroupId}:${r.searchTerm}`)
          : queue.harvestByTerm.get(r.searchTerm);
        return (
          <span className={`action action-${r.action.type}`}>
            <span className="action-label">{r.action.type === "harvest" ? "↗" : "⊘"} {r.action.label}</span>
            <span className="muted small block">{r.action.reason}</span>
            {staged ? (
              <span className="staged-cell block">
                <span className="pill st-staged">staged</span>
                {staged.kind === "harvest" && <span className="muted small"> → {staged.campaignName}</span>}
                <button className="linkish" onClick={() => unstage(staged)}>undo</button>
              </span>
            ) : harvesting === r.key ? (
              <HarvestForm term={r.searchTerm} isAsin={r.isAsin} flash={setFlash} onDone={() => setHarvesting(null)} />
            ) : r.action.type === "negate" ? (
              <button className="btn small-btn stage-btn" onClick={() => stageWithFlash([{ kind: "negative", searchTerm: r.searchTerm, campaignId: r.campaignId, adGroupId: r.adGroupId, reason: r.action!.reason }], setFlash)}>
                Stage negative
              </button>
            ) : (
              <button className="btn small-btn stage-btn" onClick={() => setHarvesting(r.key)}>Stage…</button>
            )}
          </span>
        );
      },
    },
    { key: "cost", label: "Spend", num: true, render: (r) => fmtINR(r.cost), footer: data && fmtINR(data.totals.cost) },
    { key: "sales", label: "Sales", num: true, render: (r) => fmtINR(r.sales), footer: data && fmtINR(data.totals.sales) },
    {
      key: "acos", label: "ACOS", num: true,
      render: (r) => { const a = ratio(r.cost, r.sales); return <span className={a == null ? (r.cost > 0 ? "over" : "") : a > targetAcos ? "over" : ""}>{fmtPct(a)}</span>; },
      footer: data && fmtPct(ratio(data.totals.cost, data.totals.sales)),
    },
    { key: "orders", label: "Orders", num: true, render: (r) => fmtCount(r.orders), footer: data && fmtCount(data.totals.orders) },
    { key: "clicks", label: "Clicks", num: true, render: (r) => fmtCount(r.clicks), footer: data && fmtCount(data.totals.clicks) },
    { key: "cvr", label: "CVR", num: true, hideSm: true, render: (r) => fmtPct(ratio(r.orders, r.clicks)) },
    { key: "cpc", label: "CPC", num: true, hideSm: true, render: (r) => fmtINR(ratio(r.cost, r.clicks), false, 2) },
    { key: "impressions", label: "Impr.", num: true, hideSm: true, render: (r) => fmtCount(r.impressions), footer: data && fmtCount(data.totals.impressions) },
  ];

  async function exportCsv() {
    const all: SearchTermRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`/api/search-terms?${qs({ ...query, limit: "1000", offset: String(offset) })}`);
      const body = (await res.json()) as SearchTermsResponse;
      all.push(...body.rows);
      if (all.length >= body.total || !body.rows.length) break;
    }
    downloadCsv(
      `aravi-search-terms-${view}_${range.from}_${range.to}.csv`,
      ["Search term", "Campaign", "Ad group", "Matched via", "Match type", "Suggestion", "Reason", "Impressions", "Clicks", "Spend", "Sales", "Orders", "ACOS"],
      all.map((r) => [r.searchTerm, r.campaignName, r.adGroupName, r.sourceText, r.sourceKind === "keyword" ? r.matchType : r.sourceKind,
        r.action?.label, r.action?.reason, r.impressions, r.clicks, r.cost.toFixed(2), r.sales.toFixed(2), r.orders,
        r.sales ? (r.cost / r.sales).toFixed(4) : ""])
    );
  }

  return (
    <div className="stack">
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <Card>
        <p className="eyebrow">Sponsored Products</p>
        <div className="toolbar">
          <div className="seg" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.key} className={view === v.key ? "active" : ""} onClick={() => setParams({ view: v.key === "all" ? null : v.key })}>
                {v.label} <span className="count">{data ? data.counts[v.key] : ""}</span>
              </button>
            ))}
          </div>
          <input className="search" type="search" placeholder="Search terms or keywords…" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search terms" />
          <CampaignSelect range={range} value={campaignId} onChange={(id) => setParams({ campaignId: id })} />
          <button className="btn" onClick={exportCsv} disabled={!data?.total}>Export CSV</button>
          {view === "negate" && (
            <button className="btn primary" disabled={!negatable.length} onClick={() => {
              if (confirm(`Stage ${negatable.length} negative keyword${negatable.length === 1 ? "" : "s"} from this page? Nothing is sent to Amazon until you deploy from the queue.`)) {
                stageWithFlash(negatable.map((r) => ({ kind: "negative" as const, searchTerm: r.searchTerm, campaignId: r.campaignId, adGroupId: r.adGroupId, reason: r.action!.reason })), setFlash);
              }
            }}>Stage {negatable.length} on this page</button>
          )}
        </div>
        <div className="rules muted small">
          <span><strong>Harvest</strong>: converting terms from auto, broad, phrase or product targeting, not yet an exact keyword, with ≥
            <input type="number" min={1} value={minOrders} onChange={(e) => Number(e.target.value) > 0 && setMinOrders(Number(e.target.value))} aria-label="Minimum orders to harvest" />
            orders at ACOS ≤ {fmtPct(targetAcos, 0)}.</span>
          <span><strong>Negate</strong>: ≥
            <input type="number" min={1} value={minClicks} onChange={(e) => Number(e.target.value) > 0 && setMinClicks(Number(e.target.value))} aria-label="Minimum clicks to negate" />
            clicks and no orders, or ACOS over 2× target. Skips terms already negated.</span>
        </div>
        {partial && (
          <p className="muted small notice">Search-term data starts {fmtDay(coverageStart!, true)} — Amazon only keeps it for a limited window, so earlier days in this range are missing.</p>
        )}
      </Card>

      <Card>
        {!data ? <Skeleton h={420} /> : data.rows.length === 0 ? (
          <Empty title={view === "all" ? "No search terms match" : `No ${view} candidates`}>
            {view === "all" ? "Try a different search or campaign." : "Nothing meets the rules above for this date range."}
          </Empty>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={data.rows}
              rowKey={(r) => r.key}
              sort={sort}
              dir={dir}
              onSort={(k) => setParams(nextSort(sort, dir, k, ["searchTerm"]))}
              footer
            />
            <div className="pager">
              <span className="muted small">
                {page * PAGE + 1}–{Math.min(data.total, (page + 1) * PAGE)} of {fmtCount(data.total)}
              </span>
              <span>
                <button className="btn" disabled={page === 0} onClick={() => setParams({ page: String(page - 1) })}>Previous</button>{" "}
                <button className="btn" disabled={(page + 1) * PAGE >= data.total} onClick={() => setParams({ page: String(page + 1) })}>Next</button>
              </span>
            </div>
          </>
        )}
      </Card>
      <p className="muted small">
        Staging only adds a change to the <a className="link" href="#/deploy">Deploy queue</a> — nothing reaches Amazon until you review and deploy it there.
        Totals row covers every row in this view, not just this page.{" "}
        <a className="link" href={href("/keywords", range)}>Keyword bids →</a>
      </p>
    </div>
  );
}
