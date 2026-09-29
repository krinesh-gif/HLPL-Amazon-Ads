import type { PageProps } from "../App";
import { Card, Empty, ErrorBox, Skeleton } from "../components/Ui";
import { invalidateAll, useApi } from "../lib/api";
import { fmtAgo, fmtCount, fmtDateTime } from "../lib/format";
import type { SyncStatus } from "../lib/types";

const JOBS = [
  { job: "campaigns", label: "Campaign settings", cmd: "npm run sync:campaigns", every: "daily" },
  { job: "reports", label: "Daily performance (AMS report)", cmd: "npm run sync:reports", every: "daily" },
  { job: "keywords", label: "Keywords, targets & negatives", cmd: "npm run sync:keywords", every: "daily" },
  { job: "targeting", label: "Keyword/target performance", cmd: "npm run sync:targeting", every: "daily" },
  { job: "search-terms", label: "Search terms", cmd: "npm run sync:search-terms", every: "daily" },
  { job: "sb", label: "Sponsored Brands", cmd: "npm run sync:sb", every: "daily" },
  { job: "sd", label: "Sponsored Display", cmd: "npm run sync:sd", every: "daily" },
  { job: "profiles", label: "Advertising profiles", cmd: "npm run sync:profiles", every: "once" },
];

function duration(a: string, b: string | null) {
  if (!b) return "—";
  const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function SyncPage({ meta }: PageProps) {
  const { data, error } = useApi<SyncStatus>("/api/sync");
  if (error) return <ErrorBox message={error} />;

  return (
    <div className="stack">
      <div className="sync-grid">
        {JOBS.map((j) => {
          const last = data?.lastRuns.find((r) => r.job === j.job);
          const ok = data?.lastSuccess.find((r) => r.job === j.job);
          const stale = j.every === "daily" && (!ok || Date.now() - Date.parse(ok.finishedAt) > 36 * 3_600_000);
          return (
            <Card key={j.job} className="sync-card">
              <p className="eyebrow">{j.label}</p>
              {!data ? <Skeleton h={40} /> : (
                <>
                  <p className="sync-status">
                    <span className={`status-dot ${last?.status ?? "none"}`} aria-hidden="true" />
                    {last ? (last.status === "success" ? "Last run succeeded" : last.status === "failed" ? "Last run failed" : "Running…") : "Never run"}
                  </p>
                  <p className="muted small">Last success: {ok ? `${fmtAgo(ok.finishedAt)} (${fmtDateTime(ok.finishedAt)})` : "never"}</p>
                  {stale && <p className="warn small">⚠ Stale — more than 36 h since last successful run.</p>}
                  {last?.status === "failed" && <p className="warn small">⚠ {last.detail}</p>}
                  <code className="cmd">{j.cmd}</code>
                </>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Database" actions={<button className="btn" onClick={invalidateAll}>Refresh dashboard</button>}>
        <dl className="facts">
          <div><dt>Source</dt><dd>{meta.dataSource === "demo" ? "Demo data" : meta.dataSource === "live" ? "Amazon Ads API" : "Empty"}</dd></div>
          <div><dt>Profile</dt><dd>{meta.profile ? `${meta.profile.accountName ?? meta.profile.profileId} (${meta.profile.countryCode})` : "—"}</dd></div>
          <div><dt>Campaigns</dt><dd>{fmtCount(meta.counts.campaigns)}</dd></div>
          <div><dt>Daily rows</dt><dd>{fmtCount(meta.counts.dailyRows)}</dd></div>
          <div><dt>Keywords & targets</dt><dd>{fmtCount(meta.counts.targets)}</dd></div>
          <div><dt>Search-term rows</dt><dd>{fmtCount(meta.counts.searchTermRows)}</dd></div>
          <div><dt>Data range</dt><dd>{meta.minDate ? `${meta.minDate} → ${meta.maxDate}` : "—"}</dd></div>
        </dl>
        <p className="muted small">
          Syncs run from the command line; there's no scheduler yet. <code>npm run sync:all</code> is the daily job:
          settings plus the last 14 days of every report (Amazon revises attributed sales for up to 14 days).
        </p>
      </Card>

      <Card title="Run history">
        {!data ? <Skeleton h={200} /> : data.recentRuns.length === 0 ? <Empty title="No runs yet" /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Started</th><th>Job</th><th>Status</th><th className="num">Rows</th><th className="num hide-sm">Took</th><th className="hide-sm">Detail</th></tr></thead>
              <tbody>
                {data.recentRuns.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.startedAt)}</td>
                    <td>{r.job}</td>
                    <td><span className={`status-dot ${r.status}`} aria-hidden="true" /> {r.status}</td>
                    <td className="num">{fmtCount(r.rowsSynced)}</td>
                    <td className="num hide-sm">{duration(r.startedAt, r.finishedAt)}</td>
                    <td className="hide-sm muted small truncate">{r.detail}</td>
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
