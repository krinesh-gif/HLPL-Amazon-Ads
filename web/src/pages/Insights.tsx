import { useMemo, useState } from "react";
import type { PageProps } from "../App";
import { InsightItem } from "../components/InsightItem";
import { Card, Empty, ErrorBox, Skeleton } from "../components/Ui";
import { qs, useApi } from "../lib/api";
import { computeInsights, SEVERITY_LABEL, type Severity } from "../lib/insights";
import type { CampaignsResponse } from "../lib/types";

export function InsightsPage({ range, targetAcos, onTargetAcos }: PageProps & { onTargetAcos: (v: number) => void }) {
  const { data, error } = useApi<CampaignsResponse>(`/api/campaigns?${qs({ from: range.from, to: range.to })}`);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const insights = useMemo(() => (data ? computeInsights(data.campaigns, targetAcos) : []), [data, targetAcos]);
  const counts = insights.reduce<Record<string, number>>((m, i) => ((m[i.severity] = (m[i.severity] ?? 0) + 1), m), {});
  const shown = filter === "all" ? insights : insights.filter((i) => i.severity === filter);

  if (error) return <ErrorBox message={error} />;

  return (
    <div className="stack">
      <Card>
        <div className="toolbar">
          <label className="inline-field">
            Target ACOS
            <input type="number" min={1} max={200} step={1} value={Math.round(targetAcos * 100)}
              onChange={(e) => { const v = Number(e.target.value); if (v > 0) onTargetAcos(v / 100); }} />
            %
          </label>
          <div className="seg" role="group" aria-label="Filter by severity">
            {(["all", "critical", "serious", "warning", "good"] as const).map((s) => (
              <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>
                {s === "all" ? "All" : SEVERITY_LABEL[s]} <span className="count">{s === "all" ? insights.length : counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          Suggestions only — computed from synced data for the selected dates. Nothing on this page changes your Amazon account.
        </p>
      </Card>
      <Card>
        {!data ? <Skeleton h={300} /> : shown.length ? (
          <ul className="insight-list">{shown.map((i) => <InsightItem key={i.id} insight={i} range={range} />)}</ul>
        ) : <Empty title="Nothing flagged">No campaigns match this filter for the selected dates.</Empty>}
      </Card>
    </div>
  );
}
