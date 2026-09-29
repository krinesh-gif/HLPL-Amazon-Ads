import { useMemo } from "react";
import type { PageProps } from "../App";
import { InsightItem } from "../components/InsightItem";
import { TrendChart } from "../components/TrendChart";
import { Card, Delta, Empty, ErrorBox, Skeleton, StatePill } from "../components/Ui";
import { prefetch, qs, useApi } from "../lib/api";
import { fmtINR, fmtPct, fmtRange, fmtRatio } from "../lib/format";
import { computeInsights } from "../lib/insights";
import { KPI_ORDER, METRICS, change, type MetricKey } from "../lib/metrics";
import { href, navigate } from "../lib/router";
import type { CampaignsResponse, Overview } from "../lib/types";

export function OverviewPage({ range, meta, targetAcos, params }: PageProps) {
  const q = qs({ from: range.from, to: range.to });
  const ov = useApi<Overview>(`/api/overview?${q}`);
  const cs = useApi<CampaignsResponse>(`/api/campaigns?${q}`);
  const metric = (params.get("metric") as MetricKey) || "sales";
  const def = METRICS[metric] ?? METRICS.sales;

  const selectMetric = (k: MetricKey) => {
    const p = new URLSearchParams(params);
    p.set("from", range.from);
    p.set("to", range.to);
    p.set("metric", k);
    navigate("/", p, true);
  };

  const insights = useMemo(() => (cs.data ? computeInsights(cs.data.campaigns, targetAcos) : []), [cs.data, targetAcos]);

  if (meta.dataSource === "empty") {
    return (
      <Card>
        <Empty title="No data synced yet">
          Once Amazon Ads API access is set up, run <code>npm run sync:campaigns</code> and{" "}
          <code>npm run sync:reports -- 60</code>. Want to look around first? Run <code>npm run demo</code>.
        </Empty>
      </Card>
    );
  }
  if (ov.error) return <ErrorBox message={ov.error} />;

  const d = ov.data;
  const dates = d?.daily.map((p) => p.date) ?? [];

  return (
    <div className="stack">
      <section className="kpi-grid" aria-label="Key metrics">
        {KPI_ORDER.map((k) => {
          const m = METRICS[k];
          const cur = d ? m.value(d.current) : null;
          const prev = d ? m.value(d.previous) : null;
          return (
            <button key={k} className={`kpi${k === metric ? " selected" : ""}`} onClick={() => selectMetric(k)}
              aria-pressed={k === metric} title={m.help}>
              <span className="kpi-label">{m.label}</span>
              <span className="kpi-value">{d ? m.format(cur, true) : <Skeleton h={28} w="70%" />}</span>
              <span className="kpi-foot">
                {d ? <><Delta value={change(cur, prev)} metric={m} /><span className="muted"> vs {m.format(prev, true)}</span></> : <Skeleton h={12} w="60%" />}
              </span>
            </button>
          );
        })}
      </section>

      <div className="grid-2">
        <Card title={`${def.label} per day`} subtitle={d ? `${fmtRange(d.range.from, d.range.to)} vs ${fmtRange(d.previousRange.from, d.previousRange.to)}` : " "}>
          {d ? (
            <TrendChart
              ariaLabel={`${def.label} per day, current vs previous period`}
              dates={dates}
              format={(v) => def.format(v)}
              axisFormat={(v) => def.format(v, true)}
              series={[
                { key: "cur", label: "This period", color: "var(--series-1)", values: d.daily.map((p) => def.value(p)) },
                {
                  key: "prev", label: "Previous period", color: "var(--series-prev)", dashed: true,
                  values: dates.map((_, i) => (d.previousDaily[i] ? def.value(d.previousDaily[i]) : null)),
                  dates: d.previousDaily.map((p) => p.date),
                },
              ]}
            />
          ) : <Skeleton h={260} />}
        </Card>

        <Card title="Spend vs sales" subtitle="Daily, ₹">
          {d ? (
            <TrendChart
              ariaLabel="Daily ad spend and ad sales"
              dates={dates}
              format={(v) => fmtINR(v)}
              axisFormat={(v) => fmtINR(v, true)}
              series={[
                { key: "sales", label: "Sales", color: "var(--series-1)", values: d.daily.map((p) => p.sales) },
                { key: "cost", label: "Spend", color: "var(--series-2)", values: d.daily.map((p) => p.cost) },
              ]}
            />
          ) : <Skeleton h={260} />}
        </Card>
      </div>

      <div className="grid-2 wide-left">
        <Card title="Top campaigns by spend" actions={<a className="link" href={href("/campaigns", range)}>All campaigns →</a>}>
          {cs.data ? (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr><th>Campaign</th><th className="num">Spend</th><th className="num">Sales</th><th className="num">ACOS</th><th className="num hide-sm">ROAS</th></tr>
                </thead>
                <tbody>
                  {cs.data.campaigns.filter((c) => c.cost > 0).slice(0, 8).map((c) => {
                    const a = c.sales > 0 ? c.cost / c.sales : null;
                    const url = `/campaigns/${encodeURIComponent(c.campaignId)}`;
                    return (
                      <tr key={c.campaignId} onMouseEnter={() => prefetch(`/api/campaigns/${encodeURIComponent(c.campaignId)}?${q}`)}>
                        <td className="name-cell"><a href={href(url, range)}>{c.name}</a> <StatePill state={c.state} /></td>
                        <td className="num">{fmtINR(c.cost)}</td>
                        <td className="num">{fmtINR(c.sales)}</td>
                        <td className={`num ${a == null || a > targetAcos ? "over" : ""}`}>{fmtPct(a)}</td>
                        <td className="num hide-sm">{fmtRatio(a ? 1 / a : null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Skeleton h={240} />}
        </Card>

        <Card title="Needs attention" subtitle={`Target ACOS ${fmtPct(targetAcos, 0)}`}
          actions={<a className="link" href={href("/insights", range)}>All {insights.length} →</a>}>
          {cs.data ? (
            insights.length ? (
              <ul className="insight-list">
                {insights.slice(0, 4).map((i) => <InsightItem key={i.id} insight={i} range={range} />)}
              </ul>
            ) : <Empty title="Nothing flagged">All campaigns are within target for this period.</Empty>
          ) : <Skeleton h={240} />}
        </Card>
      </div>
    </div>
  );
}
