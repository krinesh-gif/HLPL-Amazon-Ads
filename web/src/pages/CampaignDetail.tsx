import type { PageProps } from "../App";
import { TrendChart } from "../components/TrendChart";
import { Card, Delta, ErrorBox, Skeleton, StatePill } from "../components/Ui";
import { qs, useApi } from "../lib/api";
import { fmtCount, fmtDay, fmtINR, fmtPct, fmtRange } from "../lib/format";
import { KPI_ORDER, METRICS, change, type MetricKey } from "../lib/metrics";
import { href, navigate } from "../lib/router";
import type { CampaignDetail } from "../lib/types";

export function CampaignDetailPage({ range, params, targetAcos, id }: PageProps & { id: string }) {
  const q = qs({ from: range.from, to: range.to });
  const { data, error } = useApi<CampaignDetail>(`/api/campaigns/${encodeURIComponent(id)}?${q}`);
  const metric = (params.get("metric") as MetricKey) || "cost";
  const def = METRICS[metric] ?? METRICS.cost;

  if (error) return <ErrorBox message={error} />;
  const c = data?.campaign;
  const selectMetric = (k: MetricKey) => {
    const p = new URLSearchParams(params);
    p.set("from", range.from); p.set("to", range.to); p.set("metric", k);
    navigate(`/campaigns/${encodeURIComponent(id)}`, p, true);
  };

  return (
    <div className="stack">
      <a className="link back" href={href("/campaigns", range)}>← All campaigns</a>
      <Card>
        {c ? (
          <div className="detail-head">
            <div>
              <h2 className="detail-title">{c.name}</h2>
              <p className="muted small">
                ID {c.campaignId}
                {c.targetingType && <> · {c.targetingType} targeting</>}
                {c.startDate && <> · since {fmtDay(c.startDate, true)}</>}
              </p>
            </div>
            <dl className="facts">
              <div><dt>State</dt><dd><StatePill state={c.state ?? null} /></dd></div>
              <div><dt>Daily budget</dt><dd>{fmtINR(c.dailyBudget)}</dd></div>
              <div><dt>Target ACOS</dt><dd>{fmtPct(targetAcos, 0)}</dd></div>
            </dl>
            <div className="detail-links">
              <a className="btn" href={href("/keywords", { ...range, campaignId: id, kind: "all" })}>Keywords & targets</a>
              <a className="btn" href={href("/search-terms", { ...range, campaignId: id })}>Search terms</a>
            </div>
          </div>
        ) : <Skeleton h={48} />}
      </Card>

      <section className="kpi-grid" aria-label="Campaign metrics">
        {KPI_ORDER.map((k) => {
          const m = METRICS[k];
          const cur = data ? m.value(data.current) : null;
          const prev = data ? m.value(data.previous) : null;
          return (
            <button key={k} className={`kpi${k === metric ? " selected" : ""}`} onClick={() => selectMetric(k)} aria-pressed={k === metric}>
              <span className="kpi-label">{m.label}</span>
              <span className="kpi-value">{data ? m.format(cur, true) : <Skeleton h={28} w="70%" />}</span>
              <span className="kpi-foot">{data ? <Delta value={change(cur, prev)} metric={m} /> : <Skeleton h={12} w="50%" />}</span>
            </button>
          );
        })}
      </section>

      <Card title={`${def.label} per day`} subtitle={data ? fmtRange(data.range.from, data.range.to) : " "}>
        {data ? (
          data.daily.length ? (
            <TrendChart
              ariaLabel={`${def.label} per day for ${c?.name}`}
              dates={data.daily.map((p) => p.date)}
              format={(v) => def.format(v)}
              axisFormat={(v) => def.format(v, true)}
              series={[
                { key: "m", label: def.label, color: "var(--series-1)", values: data.daily.map((p) => def.value(p)) },
                ...(metric === "cost" && c?.dailyBudget
                  ? [{ key: "budget", label: "Daily budget (current)", color: "var(--series-prev)", dashed: true, values: data.daily.map(() => c.dailyBudget!) }]
                  : []),
              ]}
            />
          ) : <p className="muted">No activity in this date range.</p>
        ) : <Skeleton h={260} />}
      </Card>

      <Card title="Daily breakdown">
        {data ? (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr><th>Date</th><th className="num">Spend</th><th className="num">Sales</th><th className="num">ACOS</th><th className="num">Orders</th><th className="num hide-sm">Clicks</th><th className="num hide-sm">Impr.</th><th className="num hide-sm">CPC</th></tr>
              </thead>
              <tbody>
                {[...data.daily].reverse().map((p) => {
                  const a = p.sales > 0 ? p.cost / p.sales : null;
                  return (
                    <tr key={p.date}>
                      <td>{fmtDay(p.date, true)}</td>
                      <td className="num">{fmtINR(p.cost)}</td>
                      <td className="num">{fmtINR(p.sales)}</td>
                      <td className={`num ${a == null ? (p.cost > 0 ? "over" : "") : a > targetAcos ? "over" : ""}`}>{fmtPct(a)}</td>
                      <td className="num">{fmtCount(p.orders)}</td>
                      <td className="num hide-sm">{fmtCount(p.clicks)}</td>
                      <td className="num hide-sm">{fmtCount(p.impressions)}</td>
                      <td className="num hide-sm">{fmtINR(p.clicks ? p.cost / p.clicks : null, false, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Skeleton h={300} />}
      </Card>
      {data && <p className="muted small">Spend change vs previous period: <Delta value={change(data.current.cost, data.previous.cost)} metric={METRICS.cost} /></p>}
    </div>
  );
}
