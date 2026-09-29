import { useDeferredValue, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { Card, Delta, Empty, ErrorBox, Skeleton, StatePill } from "../components/Ui";
import { prefetch, qs, useApi } from "../lib/api";
import { downloadCsv } from "../lib/csv";
import { fmtCount, fmtINR, fmtPct, fmtRatio } from "../lib/format";
import { METRICS, change } from "../lib/metrics";
import { href, navigate } from "../lib/router";
import type { CampaignRow, CampaignsResponse } from "../lib/types";

type Col = {
  key: string;
  label: string;
  value: (c: CampaignRow) => number | string | null;
  render: (c: CampaignRow) => React.ReactNode;
  hideSm?: boolean;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function CampaignsPage({ range, targetAcos, params }: PageProps) {
  const q = qs({ from: range.from, to: range.to });
  const { data, error } = useApi<CampaignsResponse>(`/api/campaigns?${q}`);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const deferredSearch = useDeferredValue(search);
  const state = params.get("state") ?? "enabled";
  const type = params.get("type") ?? "all";
  const sort = params.get("sort") ?? "cost";
  const dir = params.get("dir") === "asc" ? 1 : -1;

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    p.set("from", range.from);
    p.set("to", range.to);
    if (v == null) p.delete(k);
    else p.set(k, v);
    navigate("/campaigns", p, true);
  };

  const columns: Col[] = [
    { key: "state", label: "State", value: (c) => c.state, render: (c) => <StatePill state={c.state} />, hideSm: true },
    { key: "dailyBudget", label: "Budget/day", value: (c) => c.dailyBudget, render: (c) => fmtINR(c.dailyBudget), hideSm: true },
    { key: "cost", label: "Spend", value: (c) => c.cost, render: (c) => fmtINR(c.cost) },
    { key: "costChange", label: "Δ Spend", value: (c) => change(c.cost, c.prevCost), render: (c) => <Delta value={change(c.cost, c.prevCost)} metric={METRICS.cost} />, hideSm: true },
    { key: "sales", label: "Sales", value: (c) => c.sales, render: (c) => fmtINR(c.sales) },
    {
      key: "acos", label: "ACOS", value: (c) => ratio(c.cost, c.sales),
      render: (c) => {
        const a = ratio(c.cost, c.sales);
        return <span className={a == null ? (c.cost > 0 ? "over" : "") : a > targetAcos ? "over" : "under"}>{fmtPct(a)}{a != null && a > targetAcos && <span className="sr-only"> (above target)</span>}</span>;
      },
    },
    { key: "roas", label: "ROAS", value: (c) => ratio(c.sales, c.cost), render: (c) => fmtRatio(ratio(c.sales, c.cost)) },
    { key: "orders", label: "Orders", value: (c) => c.orders, render: (c) => fmtCount(c.orders) },
    { key: "impressions", label: "Impr.", value: (c) => c.impressions, render: (c) => fmtCount(c.impressions), hideSm: true },
    { key: "clicks", label: "Clicks", value: (c) => c.clicks, render: (c) => fmtCount(c.clicks), hideSm: true },
    { key: "ctr", label: "CTR", value: (c) => ratio(c.clicks, c.impressions), render: (c) => fmtPct(ratio(c.clicks, c.impressions), 2), hideSm: true },
    { key: "cpc", label: "CPC", value: (c) => ratio(c.cost, c.clicks), render: (c) => fmtINR(ratio(c.cost, c.clicks), false, 2), hideSm: true },
    { key: "cvr", label: "CVR", value: (c) => ratio(c.orders, c.clicks), render: (c) => fmtPct(ratio(c.orders, c.clicks)), hideSm: true },
    { key: "capped", label: "Capped days", value: (c) => c.budgetCappedDays, render: (c) => (c.budgetCappedDays ? `${c.budgetCappedDays}/${c.activeDays}` : "—"), hideSm: true },
  ];

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = deferredSearch.trim().toLowerCase();
    const col = columns.find((c) => c.key === sort) ?? columns[2];
    return data.campaigns
      .filter((c) => (state === "all" ? true : c.state === state))
      .filter((c) => (type === "all" ? true : c.targetingType === type))
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.campaignId.includes(needle))
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name) * dir;
        const va = col.value(a), vb = col.value(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1; // nulls last in both directions
        if (vb == null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, deferredSearch, state, type, sort, dir, targetAcos]);

  const totals = useMemo(() => rows.reduce(
    (t, c) => ({ cost: t.cost + c.cost, sales: t.sales + c.sales, orders: t.orders + c.orders, clicks: t.clicks + c.clicks, impressions: t.impressions + c.impressions }),
    { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }
  ), [rows]);

  const sortProps = (key: string) => ({
    onClick: () => {
      const p = new URLSearchParams(params);
      p.set("from", range.from); p.set("to", range.to);
      p.set("sort", key);
      p.set("dir", sort === key && dir === -1 ? "asc" : "desc");
      if (key === "name" && sort !== "name") p.set("dir", "asc");
      navigate("/campaigns", p, true);
    },
    "aria-sort": (sort === key ? (dir === 1 ? "ascending" : "descending") : "none") as React.AriaAttributes["aria-sort"],
  });

  function exportCsv() {
    downloadCsv(
      `aravi-sp-campaigns_${range.from}_${range.to}.csv`,
      ["Campaign", "Campaign ID", ...columns.map((c) => c.label)],
      rows.map((r) => [r.name, r.campaignId, ...columns.map((c) => c.value(r))])
    );
  }

  if (error) return <ErrorBox message={error} />;

  return (
    <Card>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search campaigns…" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Search campaigns" />
        <div className="seg" role="group" aria-label="State">
          {["enabled", "paused", "archived", "all"].map((s) => (
            <button key={s} className={state === s ? "active" : ""} onClick={() => setParam("state", s)}>{s}</button>
          ))}
        </div>
        <select value={type} onChange={(e) => setParam("type", e.target.value)} aria-label="Targeting type">
          <option value="all">All targeting</option>
          <option value="manual">Manual</option>
          <option value="auto">Auto</option>
        </select>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>

      {!data ? <Skeleton h={400} /> : rows.length === 0 ? (
        <Empty title="No campaigns match">Try a different filter or search.</Empty>
      ) : (
        <>
          <p className="muted small summary-line">
            {rows.length} campaign{rows.length === 1 ? "" : "s"} · {fmtINR(totals.cost)} spend · {fmtINR(totals.sales)} sales · ACOS {fmtPct(ratio(totals.cost, totals.sales))}
          </p>
          <div className="table-wrap">
            <table className="table campaigns">
              <thead>
                <tr>
                  <th className="sticky-col" aria-sort={sortProps("name")["aria-sort"]}><button className="th-btn" onClick={sortProps("name").onClick}>Campaign</button></th>
                  {columns.map((c) => (
                    <th key={c.key} className={`num${c.hideSm ? " hide-sm" : ""}`} aria-sort={sortProps(c.key)["aria-sort"]}>
                      <button className="th-btn" onClick={sortProps(c.key).onClick}>
                        {c.label}{sort === c.key && <span aria-hidden="true">{dir === 1 ? " ↑" : " ↓"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const url = `/campaigns/${encodeURIComponent(c.campaignId)}`;
                  return (
                    <tr key={c.campaignId} onMouseEnter={() => prefetch(`/api/campaigns/${encodeURIComponent(c.campaignId)}?${q}`)}>
                      <td className="sticky-col name-cell">
                        <a href={href(url, range)}>{c.name}</a>
                        <span className="muted small block">{c.targetingType ?? ""}{c.targetingType ? " · " : ""}{c.campaignId}</span>
                      </td>
                      {columns.map((col) => (
                        <td key={col.key} className={`num${col.hideSm ? " hide-sm" : ""}`}>{col.render(c)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky-col">Total</td>
                  {columns.map((col) => {
                    const t = totals;
                    const v: Record<string, string> = {
                      cost: fmtINR(t.cost), sales: fmtINR(t.sales), acos: fmtPct(ratio(t.cost, t.sales)),
                      roas: fmtRatio(ratio(t.sales, t.cost)), orders: fmtCount(t.orders), impressions: fmtCount(t.impressions),
                      clicks: fmtCount(t.clicks), ctr: fmtPct(ratio(t.clicks, t.impressions), 2),
                      cpc: fmtINR(ratio(t.cost, t.clicks), false, 2), cvr: fmtPct(ratio(t.orders, t.clicks)),
                    };
                    return <td key={col.key} className={`num${col.hideSm ? " hide-sm" : ""}`}>{v[col.key] ?? ""}</td>;
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small table-note">ACOS in <span className="over">red</span> is above your {fmtPct(targetAcos, 0)} target (change it on Insights). “Capped days” uses the campaign’s current budget.</p>
        </>
      )}
    </Card>
  );
}
