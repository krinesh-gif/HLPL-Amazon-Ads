import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { Card, Empty, ErrorBox, Skeleton } from "../components/Ui";
import { send, useApi } from "../lib/api";
import { fmtDateTime, fmtINR } from "../lib/format";
import { unstage, useQueue } from "../lib/queue";
import type { Change, ChangeKind, Deploy, DeployMode } from "../lib/types";

const KIND_LABEL: Record<ChangeKind, string> = {
  bid: "Bid change",
  state: "Pause / enable",
  negative: "Add negative",
  harvest: "Harvest",
  remove_negative: "Remove negative",
  archive_keyword: "Archive keyword",
};

const MODE_COPY: Record<DeployMode, { title: string; body: string; cls: string }> = {
  live: {
    title: "LIVE — deploying changes your Amazon ads",
    body: "Changes are sent to the Amazon Ads API for your account when you confirm.",
    cls: "mode-live",
  },
  dry_run: {
    title: "Dry run — nothing will be sent to Amazon",
    body: "Live writes are off (AMAZON_ADS_WRITES_ENABLED isn't set to true). Deploy checks every change and records exactly what it would send.",
    cls: "mode-dry",
  },
  demo: {
    title: "Demo — changes apply to the demo data only",
    body: "This is the demo database, so deploys update the demo numbers and never reach Amazon.",
    cls: "mode-demo",
  },
};

/** "₹15.68 → ₹12.74", "enabled → paused", "+ negative exact", … */
export function describeChange(c: Change): string {
  const o = c.oldValue ?? {};
  const n = c.newValue;
  switch (c.kind) {
    case "bid": return `${fmtINR(o.bid as number, false, 2)}${o.bidIsDefault ? " (default)" : ""} → ${fmtINR(n.bid as number, false, 2)}`;
    case "state": return `${o.state} → ${n.state}`;
    case "negative": return c.targetKind === "asin" ? "+ negative ASIN target" : "+ negative exact";
    case "harvest": return `+ ${c.targetKind === "asin" ? "ASIN target" : "exact keyword"} at ${fmtINR(n.bid as number, false, 2)}`;
    case "remove_negative": return "remove the negative";
    case "archive_keyword": return "archive the harvested keyword";
  }
}

function Impact({ v }: { v: number | null }) {
  if (v == null) return <span className="muted">—</span>;
  const r = Math.round(v);
  if (r === 0) return <span className="muted">≈ ₹0</span>;
  return <span className={r > 0 ? "impact up" : "impact down"}>{r > 0 ? "+" : "−"}{fmtINR(Math.abs(r))}/day</span>;
}

function StatusPill({ c }: { c: Change }) {
  const label: Record<Change["status"], string> = {
    staged: "staged", deployed: "deployed", demo_applied: "applied (demo)", dry_run: "dry run", failed: "failed", discarded: "discarded",
  };
  return <span className={`pill st-${c.status}`}>{label[c.status]}</span>;
}

export function DeployPage(_: PageProps) {
  const queue = useQueue();
  const history = useApi<{ deploys: Deploy[] }>("/api/deploys");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ mode: DeployMode; succeeded: number; failed: number; deployId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changes = queue.data?.changes ?? [];
  const limits = queue.data?.limits;
  const mode = queue.data?.mode ?? "dry_run";

  // Default: everything selected (up to the per-deploy cap); drop ids that left the queue.
  useEffect(() => {
    if (!queue.data) return;
    setSelected((prev) => {
      const ids = changes.map((c) => c.id);
      const kept = new Set([...prev].filter((id) => ids.includes(id)));
      if (kept.size === 0) return new Set(ids.slice(0, limits?.maxPerDeploy ?? 100));
      return kept;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.data]);

  const chosen = useMemo(() => changes.filter((c) => selected.has(c.id)), [changes, selected]);
  const est = chosen.reduce((s, c) => s + (c.estDailyCostDelta ?? 0), 0);
  const byKind = chosen.reduce<Record<string, number>>((m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {});
  const overCap = limits ? chosen.length > limits.maxPerDeploy : false;

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  async function deploy() {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ mode: DeployMode; succeeded: number; failed: number; deployId: number }>("POST", "/api/deploys", {
        ids: chosen.map((c) => c.id), acknowledgeLive: mode === "live" ? ack : undefined, expectedMode: mode,
      });
      setResult(r);
      setConfirming(false);
      setAck(false);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revert(c: Change) {
    try {
      await send("POST", `/api/changes/${c.id}/revert`);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  if (queue.error) return <ErrorBox message={queue.error} />;
  const m = MODE_COPY[mode];

  return (
    <div className="stack">
      <div className={`mode-banner ${m.cls}`} role="status">
        <strong>{m.title}</strong>
        <span>{m.body}</span>
      </div>

      {result && (
        <div className={`card result ${result.failed ? "partial" : "ok"}`} role="status">
          <strong>Deploy #{result.deployId}: {result.succeeded} {result.mode === "live" ? "deployed" : result.mode === "demo" ? "applied to demo data" : "checked (dry run)"}
            {result.failed ? `, ${result.failed} failed` : ""}.</strong>
          <span className="muted small"> Details are in the history below{result.failed ? " — failed items say why and can be re-staged" : ""}.</span>
        </div>
      )}

      <Card title="Ready to deploy" subtitle={limits && `Guardrails: bids ₹${limits.minBid}–₹${limits.maxBid}, ±${limits.maxStep * 100}% per step, up to ${limits.maxPerDeploy} changes per deploy. Each change is re-checked against the latest sync before it's sent.`}>
        {!queue.data ? <Skeleton h={200} /> : changes.length === 0 ? (
          <Empty title="Nothing staged">Stage bid changes on <a className="link" href="#/keywords">Keywords</a>, or negatives and harvests on <a className="link" href="#/search-terms">Search terms</a>. They wait here until you deploy.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table campaigns">
                <thead>
                  <tr>
                    <th className="sticky-col">
                      <input type="checkbox" aria-label="Select all" checked={chosen.length === changes.length}
                        onChange={(e) => setSelected(new Set(e.target.checked ? changes.map((c) => c.id) : []))} />
                    </th>
                    <th>Change</th><th>What</th><th className="num">Est. spend impact</th><th className="hide-sm">Why</th><th className="hide-sm">Staged</th><th />
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.id}>
                      <td className="sticky-col"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.label}`} /></td>
                      <td><span className={`pill kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span></td>
                      <td className="what">
                        <strong>{c.label}</strong> <span className="muted">{describeChange(c)}</span>
                        <span className="muted small block">{c.campaignName ?? c.campaignId}{c.adGroupName ? ` › ${c.adGroupName}` : ""}</span>
                      </td>
                      <td className="num"><Impact v={c.estDailyCostDelta} /></td>
                      <td className="hide-sm muted small why">{c.reason ?? "—"}</td>
                      <td className="hide-sm muted small">{c.createdBy}<span className="block">{fmtDateTime(c.createdAt)}</span></td>
                      <td><button className="btn small-btn" onClick={() => unstage(c)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="deploy-bar">
              <div>
                <strong>{chosen.length} selected</strong>
                <span className="muted"> · estimated spend impact </span><Impact v={est} />
                {overCap && <p className="warn small">Over the {limits!.maxPerDeploy}-change limit — deselect some and deploy in batches.</p>}
              </div>
              <button className={`btn ${mode === "live" ? "danger" : "primary"}`} disabled={!chosen.length || overCap}
                onClick={() => { setConfirming(true); setError(null); }}>
                Review &amp; deploy {chosen.length || ""}
              </button>
            </div>
            <p className="muted small">Estimates are rough: current ₹/day of what's being changed over the last {limits?.estimateDays} synced days, scaled by the change. Harvest shows an upper bound (most of that traffic moves over from the source target).</p>
          </>
        )}
      </Card>

      {confirming && (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setConfirming(false)}>
          <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title">{mode === "live" ? "Deploy to Amazon?" : mode === "demo" ? "Apply to demo data?" : "Run a dry-run deploy?"}</h2>
            <p className={`mode-inline ${m.cls}`}>{m.title}</p>
            <ul className="confirm-list">
              {Object.entries(byKind).map(([k, n]) => <li key={k}><strong>{n}</strong> × {KIND_LABEL[k as ChangeKind]}</li>)}
            </ul>
            <p>Estimated spend impact: <Impact v={est} /></p>
            {mode === "live" && (
              <label className="check ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I understand these {chosen.length} changes will go live on Aravi's Amazon ad account.
              </label>
            )}
            {error && <p className="warn small" role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              <button className={`btn ${mode === "live" ? "danger" : "primary"}`} onClick={deploy} disabled={busy || (mode === "live" && !ack)}>
                {busy ? "Deploying…" : mode === "live" ? `Deploy ${chosen.length} to Amazon` : mode === "demo" ? `Apply ${chosen.length}` : `Dry-run ${chosen.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <Card title="Deploy history" subtitle="Every deploy, who ran it, and what happened to each change. Revert stages the reverse change — it still needs a deploy.">
        {!history.data ? <Skeleton h={120} /> : history.data.deploys.length === 0 ? <Empty title="No deploys yet" /> : (
          <div className="history">
            {history.data.deploys.map((d) => (
              <details key={d.id} open={d.id === history.data!.deploys[0].id}>
                <summary>
                  <span className={`pill mode-pill-${d.mode}`}>{d.mode === "dry_run" ? "dry run" : d.mode}</span>
                  <strong> #{d.id}</strong> · {fmtDateTime(d.startedAt)} · {d.deployedBy} · {d.succeeded}/{d.total} ok
                  {d.failed > 0 && <span className="warn"> · {d.failed} failed</span>}
                  <span className="muted"> · est. </span><Impact v={d.estDailyCostDelta} />
                </summary>
                <div className="table-wrap">
                  <table className="table compact">
                    <tbody>
                      {d.changes.map((c) => (
                        <tr key={c.id}>
                          <td><StatusPill c={c} /></td>
                          <td className="what"><strong>{c.label}</strong> <span className="muted">{describeChange(c)}</span>
                            <span className="muted small block">{c.campaignName ?? c.campaignId}{c.adGroupName ? ` › ${c.adGroupName}` : ""}</span></td>
                          <td className="muted small why">{c.resultMessage}</td>
                          <td>
                            {(c.status === "deployed" || c.status === "demo_applied") && !c.reverted && c.kind !== "remove_negative" && c.kind !== "archive_keyword" && (
                              <button className="btn small-btn" onClick={() => revert(c)}>Revert</button>
                            )}
                            {c.reverted && <span className="muted small">revert staged/done</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
