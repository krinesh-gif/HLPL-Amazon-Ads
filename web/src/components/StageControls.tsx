import { useEffect, useState } from "react";
import { fmtINR } from "../lib/format";
import { stage, unstage, type StageRequest } from "../lib/queue";
import type { Change, TargetRow } from "../lib/types";

/** Page-level message after staging ("3 staged, 1 refused: …"). */
export function Flash({ msg, onClose }: { msg: { text: string; bad?: boolean } | null; onClose: () => void }) {
  if (!msg) return null;
  return (
    <div className={`flash ${msg.bad ? "bad" : ""}`} role="status">
      <span>{msg.text}</span>
      <a className="link" href="#/deploy">Deploy queue →</a>
      <button className="linkish" onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  );
}

export type FlashFn = (m: { text: string; bad?: boolean }) => void;

export async function stageWithFlash(reqs: StageRequest[], flash: FlashFn): Promise<void> {
  try {
    const r = await stage(reqs);
    const bad = r.errors.length;
    if (!r.staged.length) {
      flash({ text: `Not staged: ${r.errors[0]?.error ?? "refused"}${bad > 1 ? ` (and ${bad - 1} more)` : ""}`, bad: true });
      return;
    }
    flash({
      text: `${r.staged.length} change${r.staged.length === 1 ? "" : "s"} staged — nothing has been sent to Amazon yet.` +
        (bad ? ` ${bad} refused, e.g. ${r.errors[0].error}` : ""),
    });
  } catch (e) {
    flash({ text: (e as Error).message, bad: true });
  }
}

/** Per-row staging controls on Keywords & targets. */
export function TargetActions({ r, staged, flash }: { r: TargetRow; staged: { bid?: Change; state?: Change }; flash: FlashFn }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (staged.bid || staged.state) {
    const c = (staged.bid ?? staged.state)!;
    return (
      <span className="staged-cell">
        <span className="pill st-staged">staged</span>{" "}
        {staged.bid ? `→ ${fmtINR(staged.bid.newValue.bid as number, false, 2)}` : `→ ${staged.state!.newValue.state}`}
        {staged.bid && staged.state ? ` + ${staged.state.newValue.state}` : ""}
        <button className="linkish" onClick={() => { unstage(c); if (staged.bid && staged.state) unstage(staged.state); }}>undo</button>
      </span>
    );
  }
  if (r.state !== "enabled" && r.state !== "paused") return <span className="muted small">—</span>;

  if (editing) {
    return (
      <form className="inline-edit" onSubmit={(e) => {
        e.preventDefault();
        stageWithFlash([{ kind: "bid", targetId: r.targetId, bid: Number(value), reason: "Manual bid" }], flash).then(() => setEditing(false));
      }}>
        <span className="muted">₹</span>
        <input type="number" step="0.01" min={1} max={100} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="New bid" />
        <button className="btn small-btn primary" type="submit">Stage</button>
        <button className="linkish" type="button" onClick={() => setEditing(false)}>cancel</button>
      </form>
    );
  }
  return (
    <span className="row-actions">
      {r.state === "enabled" && r.suggestedBid != null && (
        <button className="btn small-btn" onClick={() => stageWithFlash([{ kind: "bid", targetId: r.targetId, bid: r.suggestedBid!, reason: r.suggestion }], flash)}>
          Stage {fmtINR(r.suggestedBid, false, 2)}
        </button>
      )}
      <button className="linkish" onClick={() => { setValue(String(r.bid ?? "")); setEditing(true); }}>edit bid</button>
      <button className="linkish" onClick={() => stageWithFlash([{ kind: "state", targetId: r.targetId, state: r.state === "enabled" ? "paused" : "enabled",
        reason: r.state === "enabled" ? (r.orders === 0 && r.cost > 0 ? `No orders, ${fmtINR(r.cost)} spent` : "Paused manually") : "Re-enabled manually" }], flash)}>
        {r.state === "enabled" ? "pause" : "enable"}
      </button>
    </span>
  );
}

interface HarvestOptions {
  adGroups: { adGroupId: string; campaignId: string; adGroupName: string; campaignName: string; exactKeywords: number; productTargets: number }[];
  suggestedBid: number | null;
}

/** Picks a sensible default destination: an exact/ASIN ad group whose campaign shares the most words with the term. */
function defaultAdGroup(o: HarvestOptions, term: string, isAsin: boolean): string {
  const words = new Set(term.split(/\s+/));
  const pool = o.adGroups.filter((g) => (isAsin ? g.productTargets > 0 : g.exactKeywords > 0));
  const score = (g: HarvestOptions["adGroups"][number]) =>
    g.campaignName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => words.has(w)).length;
  const best = [...(pool.length ? pool : o.adGroups)].sort((a, b) => score(b) - score(a))[0];
  return best?.adGroupId ?? "";
}

/** Inline form: harvest a search term as an exact keyword (or ASIN target) into a chosen ad group. */
export function HarvestForm({ term, isAsin, onDone, flash }: { term: string; isAsin: boolean; onDone: () => void; flash: FlashFn }) {
  const [opts, setOpts] = useState<HarvestOptions | null>(null);
  const [adGroupId, setAdGroupId] = useState("");
  const [bid, setBid] = useState("");
  useEffect(() => {
    fetch(`/api/harvest-options?term=${encodeURIComponent(term)}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((o: HarvestOptions) => {
        setOpts(o);
        setAdGroupId(defaultAdGroup(o, term, isAsin));
        setBid(o.suggestedBid != null ? String(o.suggestedBid) : "");
      });
  }, [term, isAsin]);
  if (!opts) return <span className="muted small">Loading ad groups…</span>;
  const g = opts.adGroups.find((x) => x.adGroupId === adGroupId);
  return (
    <form className="harvest-form" onSubmit={(e) => {
      e.preventDefault();
      if (!g) return;
      stageWithFlash([{ kind: "harvest", searchTerm: term, campaignId: g.campaignId, adGroupId: g.adGroupId, bid: Number(bid),
        reason: `Harvested from search terms` }], flash).then(onDone);
    }}>
      <label className="small">Add to
        <select value={adGroupId} onChange={(e) => setAdGroupId(e.target.value)} required>
          {opts.adGroups.map((x) => <option key={x.adGroupId} value={x.adGroupId}>{x.campaignName} › {x.adGroupName}</option>)}
        </select>
      </label>
      <label className="small">Bid ₹
        <input type="number" step="0.01" min={1} max={100} value={bid} onChange={(e) => setBid(e.target.value)} required />
      </label>
      <span>
        <button className="btn small-btn primary" type="submit">Stage</button>{" "}
        <button className="linkish" type="button" onClick={onDone}>cancel</button>
      </span>
    </form>
  );
}
