import { useDeferredValue, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { CampaignSelect } from "../components/CampaignSelect";
import { DataTable, nextSort, type Column } from "../components/DataTable";
import { Card, Empty, ErrorBox, Skeleton, StatePill } from "../components/Ui";
import { qs, useApi } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import { fmtCount, fmtINR, fmtPct } from "../lib/format";
import { navigate } from "../lib/router";
import type { TargetRow, TargetsResponse } from "../lib/types";

const KINDS = [
  { key: "keyword", label: "Keywords" },
  { key: "product", label: "Product targets" },
  { key: "auto", label: "Auto targets" },
  { key: "all", label: "All" },
] as const;
const PAGE = 200;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function sortValue(r: TargetRow, key: string): number | string | null {
  switch (key) {
    case "text": return r.text.toLowerCase();
    case "acos": return ratio(r.cost, r.sales);
    case "cpc": return ratio(r.cost, r.clicks);
    case "cvr": return ratio(r.orders, r.clicks);
    case "bid": return r.bid;
    case "change": return r.suggestedBid != null && r.bid ? r.suggestedBid / r.bid - 1 : null;
    case "sales": case "orders": case "clicks": case "impressions": case "cost": return r[key];
    default: return r.cost;
  }
}

export function KeywordsPage({ range, targetAcos, params }: PageProps) {
  const kind = params.get("kind") ?? "keyword";
  const state = params.get("state") ?? "enabled";
  const campaignId = params.get("campaignId") ?? "";
  const only = params.get("only") === "1";
  const sort = params.get("sort") ?? "cost";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const needle = useDeferredValue(search.trim().toLowerCase());
  const [shown, setShown] = useState(PAGE);

  const { data, error } = useApi<TargetsResponse>(
    `/api/targets?${qs({ from: range.from, to: range.to, targetAcos: String(targetAcos), ...(campaignId ? { campaignId } : {}) })}`
  );

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    p.set("from", range.from);
    p.set("to", range.to);
    for (const [k, v] of Object.entries(patch)) v == null || v === "" ? p.delete(k) : p.set(k, v);
    setShown(PAGE);
    navigate("/keywords", p, true);
  };

  const byState = useMemo(
    () => (data?.rows ?? []).filter((r) => state === "all" || (r.state ?? "archived") === state),
    [data, state]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: byState.length, keyword: 0, product: 0, auto: 0 };
    for (const r of byState) c[r.kind]++;
    return c;
  }, [byState]);

  const rows = useMemo(() => {
    const dirN = dir === "asc" ? 1 : -1;
    return byState
      .filter((r) => kind === "all" || r.kind === kind)
      .filter((r) => !only || r.suggestedBid != null)
      .filter((r) => !needle || r.text.toLowerCase().includes(needle) || (r.campaignName ?? "").toLowerCase().includes(needle))
      .sort((a, b) => {
        const x = sortValue(a, sort), y = sortValue(b, sort);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * dirN;
      });
  }, [byState, kind, only, needle, sort, dir]);

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({ cost: t.cost + r.cost, sales: t.sales + r.sales, orders: t.orders + r.orders, clicks: t.clicks + r.clicks, impressions: t.impressions + r.impressions }),
    { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }
  ), [rows]);

  if (error) return <ErrorBox message={error} />;

  const columns: Column<TargetRow>[] = [
    {
      key: "text", label: kind === "keyword" ? "Keyword" : "Target",
      render: (r) => (
        <span className="term-cell">
          <strong>{r.text}</strong>
          <span className={`pill kind-${r.kind}`}>{r.kind === "keyword" ? r.matchType : r.kind}</span>
          <span className="muted small block truncate-sm">{r.campaignName ?? r.campaignId}{r.adGroupName ? ` › ${r.adGroupName}` : ""}</span>
        </span>
      ),
      footer: `${fmtCount(rows.length)} shown`,
    },
    { key: "state", label: "State", sortable: false, hideSm: true, render: (r) => <StatePill state={r.state ?? "archived"} /> },
    {
      key: "bid", label: "Bid", num: true,
      render: (r) => <span title={r.bidIsDefault ? "Ad group default bid" : undefined}>{fmtINR(r.bid, false, 2)}{r.bidIsDefault && <span className="muted">*</span>}</span>,
    },
    {
      key: "change", label: "Suggested bid", num: true,
      render: (r) => {
        if (r.suggestedBid == null || r.bid == null) return <span className="muted small">{r.suggestion}</span>;
        const ch = r.suggestedBid / r.bid - 1;
        return (
          <span className="suggest">
            <strong className={ch < 0 ? "down" : "up"}>{fmtINR(r.suggestedBid, false, 2)}</strong>
            <span className="muted small"> {ch < 0 ? "↓" : "↑"}{Math.abs(ch * 100).toFixed(0)}%</span>
            <span className="muted small block">{r.suggestion}</span>
          </span>
        );
      },
    },
    { key: "cost", label: "Spend", num: true, render: (r) => fmtINR(r.cost), footer: fmtINR(totals.cost) },
    { key: "sales", label: "Sales", num: true, render: (r) => fmtINR(r.sales), footer: fmtINR(totals.sales) },
    {
      key: "acos", label: "ACOS", num: true,
      render: (r) => { const a = ratio(r.cost, r.sales); return <span className={a == null ? (r.cost > 0 ? "over" : "") : a > targetAcos ? "over" : ""}>{fmtPct(a)}</span>; },
      footer: fmtPct(ratio(totals.cost, totals.sales)),
    },
    { key: "orders", label: "Orders", num: true, render: (r) => fmtCount(r.orders), footer: fmtCount(totals.orders) },
    { key: "clicks", label: "Clicks", num: true, hideSm: true, render: (r) => fmtCount(r.clicks), footer: fmtCount(totals.clicks) },
    { key: "cpc", label: "CPC", num: true, hideSm: true, render: (r) => fmtINR(ratio(r.cost, r.clicks), false, 2) },
    { key: "cvr", label: "CVR", num: true, hideSm: true, render: (r) => fmtPct(ratio(r.orders, r.clicks)) },
    { key: "impressions", label: "Impr.", num: true, hideSm: true, render: (r) => fmtCount(r.impressions), footer: fmtCount(totals.impressions) },
  ];

  function exportCsv() {
    downloadCsv(
      `aravi-${kind === "all" ? "targets" : kind}_${range.from}_${range.to}.csv`,
      ["Keyword / target", "Type", "Match", "Campaign", "Ad group", "State", "Bid", "Suggested bid", "Reason", "Impressions", "Clicks", "Spend", "Sales", "Orders", "ACOS", "Keyword/target ID"],
      rows.map((r) => [r.text, r.kind, r.matchType, r.campaignName, r.adGroupName, r.state, r.bid, r.suggestedBid, r.suggestion,
        r.impressions, r.clicks, r.cost.toFixed(2), r.sales.toFixed(2), r.orders, r.sales ? (r.cost / r.sales).toFixed(4) : "", r.targetId])
    );
  }

  return (
    <div className="stack">
      <Card>
        <p className="eyebrow">Sponsored Products</p>
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Type">
            {KINDS.map((k) => (
              <button key={k.key} className={kind === k.key ? "active" : ""} onClick={() => setParams({ kind: k.key === "keyword" ? null : k.key })}>
                {k.label} <span className="count">{data ? counts[k.key] : ""}</span>
              </button>
            ))}
          </div>
          <input className="search" type="search" placeholder="Search keywords, targets or campaigns…" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search keywords" />
          <CampaignSelect range={range} value={campaignId} onChange={(id) => setParams({ campaignId: id })} />
          <select value={state} onChange={(e) => setParams({ state: e.target.value === "enabled" ? null : e.target.value })} aria-label="State">
            <option value="enabled">Enabled</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived / removed</option>
            <option value="all">All states</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={only} onChange={(e) => setParams({ only: e.target.checked ? "1" : null })} />
            Only with a bid suggestion
          </label>
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        </div>
        <p className="muted small">
          Suggested bids move each bid toward your {fmtPct(targetAcos, 0)} target ACOS, at most ±30% per step, once a target has 10+ clicks.
          Targets with no orders are cut 30% only after they've had enough clicks that the account's conversion rate
          ({fmtPct(data?.accountCvr ?? null)}) says an order was due. <span aria-hidden="true">*</span> = ad group default bid.
        </p>
      </Card>

      <Card>
        {!data ? <Skeleton h={420} /> : rows.length === 0 ? (
          <Empty title="Nothing to show">No {kind === "all" ? "targets" : KINDS.find((k) => k.key === kind)?.label.toLowerCase()} match these filters.</Empty>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows.slice(0, shown)}
              rowKey={(r) => r.targetId}
              sort={sort}
              dir={dir}
              onSort={(k) => setParams(nextSort(sort, dir, k, ["text"]))}
              footer
            />
            {rows.length > shown && (
              <div className="pager">
                <span className="muted small">Showing {fmtCount(shown)} of {fmtCount(rows.length)}</span>
                <button className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more</button>
              </div>
            )}
          </>
        )}
      </Card>
      <p className="muted small">Read-only — suggested bids are not applied. Changing bids from here will need the staged “ready to deploy” flow, which we'll design together first.</p>
    </div>
  );
}
