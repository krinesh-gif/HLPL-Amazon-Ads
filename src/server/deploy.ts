import { writesEnabled } from "../config/flags.js";
import { db } from "../db/client.js";
import type { V3WriteResult } from "../amazon-ads/client.js";
import { LIMITS, checkBid, type ChangeRow } from "./changes.js";

/**
 * The explicit second step: sends staged changes to Amazon.
 *
 * Modes (decided server-side, shown in the UI before confirming):
 *  - live:    AMAZON_ADS_WRITES_ENABLED=true and real data → calls the Amazon Ads API.
 *  - dry_run: writes disabled → validates everything and records what *would* be sent. Nothing sent.
 *  - demo:    demo database → applies to the local demo data only. Nothing sent.
 *
 * Every item is re-checked right before sending: guardrails again, and that the value it
 * replaces still matches the latest sync (so a change made in Amazon since staging isn't overwritten).
 */

export type DeployMode = "live" | "dry_run" | "demo";

export function deployMode(): DeployMode {
  const demo = (db.prepare(`SELECT value FROM meta WHERE key = 'data_source'`).pluck().get() as string | undefined) === "demo";
  if (demo) return "demo";
  return writesEnabled ? "live" : "dry_run";
}

export class DeployError extends Error {}

const q = {
  byId: db.prepare(`SELECT * FROM change_queue WHERE id = ?`),
  target: db.prepare(`SELECT t.bid, t.state, g.default_bid AS defaultBid FROM sp_targets t LEFT JOIN sp_ad_groups g ON g.ad_group_id = t.ad_group_id WHERE t.target_id = ?`),
  insertDeploy: db.prepare(`INSERT INTO deploys (mode, deployed_by, started_at, total, est_daily_cost_delta) VALUES (?, ?, ?, ?, ?) RETURNING id`),
  finishDeploy: db.prepare(`UPDATE deploys SET finished_at = ?, succeeded = ?, failed = ? WHERE id = ?`),
  markResult: db.prepare(`UPDATE change_queue SET status = ?, deploy_id = ?, result_message = ?, entity_id = COALESCE(?, entity_id) WHERE id = ?`),
  // Local updates after a successful write, so the dashboard reflects it before the next sync.
  setBid: db.prepare(`UPDATE sp_targets SET bid = ? WHERE target_id = ?`),
  setState: db.prepare(`UPDATE sp_targets SET state = ? WHERE target_id = ?`),
  addNegative: db.prepare(`INSERT OR REPLACE INTO sp_negative_keywords (negative_id, campaign_id, ad_group_id, text, match_type, synced_at) VALUES (?, ?, ?, ?, ?, ?)`),
  removeNegative: db.prepare(`DELETE FROM sp_negative_keywords WHERE negative_id = ?`),
  addTarget: db.prepare(`INSERT OR REPLACE INTO sp_targets (target_id, kind, campaign_id, ad_group_id, text, match_type, state, bid, synced_at) VALUES (?, ?, ?, ?, ?, ?, 'enabled', ?, ?)`),
};

interface Outcome {
  ok: boolean;
  message: string;
  amazonId?: string;
}

/** Re-validates one staged item against the latest synced state. Returns an error message or null. */
function precheck(c: ChangeRow): string | null {
  const oldV = c.old_value ? JSON.parse(c.old_value) : null;
  const newV = JSON.parse(c.new_value);
  if (c.kind === "bid" || c.kind === "state") {
    const t = q.target.get(c.entity_id) as { bid: number | null; state: string; defaultBid: number | null } | undefined;
    if (!t) return "No longer in the synced data";
    if (c.kind === "bid") {
      const current = t.bid ?? t.defaultBid;
      if (current !== oldV?.bid) return `Bid changed since this was staged (now ₹${current}) — re-stage it`;
      try {
        checkBid(newV.bid, current, c.source === "revert");
      } catch (e) {
        return (e as Error).message;
      }
    } else if (t.state !== oldV?.state) {
      return `State changed since this was staged (now ${t.state}) — re-stage it`;
    }
  }
  if (c.kind === "harvest") {
    if (newV.bid < LIMITS.minBid || newV.bid > LIMITS.maxBid) return "Bid outside ₹1–₹100";
  }
  return null;
}

type Group = { items: ChangeRow[]; send: (w: Writers) => Promise<V3WriteResult> };
type Writers = {
  kw: typeof import("../amazon-ads/keywordWrites.js");
  tg: typeof import("../amazon-ads/targetWrites.js");
  neg: typeof import("../amazon-ads/negativeWrites.js");
};

/** Groups items into one bulk API call per (operation, entity type). */
function plan(items: ChangeRow[]): Group[] {
  const v = (c: ChangeRow) => JSON.parse(c.new_value);
  const isKw = (c: ChangeRow) => c.target_kind === "keyword";
  const pick = (f: (c: ChangeRow) => boolean) => items.filter(f);
  const groups: Group[] = [
    { items: pick((c) => c.kind === "bid" && isKw(c)), send: (w) => w.kw.updateKeywords(groups[0].items.map((c) => ({ keywordId: c.entity_id!, bid: v(c).bid }))) },
    { items: pick((c) => c.kind === "bid" && !isKw(c)), send: (w) => w.tg.updateTargets(groups[1].items.map((c) => ({ targetId: c.entity_id!, bid: v(c).bid }))) },
    { items: pick((c) => c.kind === "state" && isKw(c)), send: (w) => w.kw.updateKeywords(groups[2].items.map((c) => ({ keywordId: c.entity_id!, state: v(c).state.toUpperCase() }))) },
    { items: pick((c) => c.kind === "state" && !isKw(c)), send: (w) => w.tg.updateTargets(groups[3].items.map((c) => ({ targetId: c.entity_id!, state: v(c).state.toUpperCase() }))) },
    { items: pick((c) => c.kind === "negative" && c.target_kind === "keyword"), send: (w) => w.neg.createNegativeExact(groups[4].items.map((c) => ({ campaignId: c.campaign_id, adGroupId: c.ad_group_id, keywordText: c.label }))) },
    { items: pick((c) => c.kind === "negative" && c.target_kind === "asin"), send: (w) => w.neg.createNegativeAsins(groups[5].items.map((c) => ({ campaignId: c.campaign_id, adGroupId: c.ad_group_id, asin: c.label }))) },
    { items: pick((c) => c.kind === "harvest" && c.target_kind === "keyword"), send: (w) => w.kw.createExactKeywords(groups[6].items.map((c) => ({ campaignId: c.campaign_id, adGroupId: c.ad_group_id, keywordText: c.label, bid: v(c).bid }))) },
    { items: pick((c) => c.kind === "harvest" && c.target_kind === "asin"), send: (w) => w.tg.createAsinTargets(groups[7].items.map((c) => ({ campaignId: c.campaign_id, adGroupId: c.ad_group_id, asin: c.label, bid: v(c).bid }))) },
    { items: pick((c) => c.kind === "remove_negative" && c.target_kind === "keyword"), send: (w) => w.neg.deleteNegativeKeywords(groups[8].items.map((c) => c.entity_id!)) },
    { items: pick((c) => c.kind === "remove_negative" && c.target_kind === "asin"), send: (w) => w.neg.deleteNegativeTargets(groups[9].items.map((c) => c.entity_id!)) },
    { items: pick((c) => c.kind === "archive_keyword" && c.target_kind === "keyword"), send: (w) => w.kw.archiveKeywords(groups[10].items.map((c) => c.entity_id!)) },
    { items: pick((c) => c.kind === "archive_keyword" && c.target_kind === "asin"), send: (w) => w.tg.archiveTargets(groups[11].items.map((c) => c.entity_id!)) },
  ];
  return groups.filter((g) => g.items.length);
}

/** Mirrors a successful change into the local tables. */
function applyLocally(c: ChangeRow, amazonId: string | undefined) {
  const v = JSON.parse(c.new_value);
  const now = new Date().toISOString();
  switch (c.kind) {
    case "bid": q.setBid.run(v.bid, c.entity_id); break;
    case "state": q.setState.run(v.state, c.entity_id); break;
    case "negative": q.addNegative.run(amazonId, c.campaign_id, c.ad_group_id, c.label, c.target_kind === "asin" ? "negative_asin" : "negative_exact", now); break;
    case "remove_negative": q.removeNegative.run(c.entity_id); break;
    case "harvest":
      q.addTarget.run(amazonId, c.target_kind === "asin" ? "product" : "keyword", c.campaign_id, c.ad_group_id,
        c.target_kind === "asin" ? `asin="${c.label.toUpperCase()}"` : c.label, c.target_kind === "asin" ? null : "exact", v.bid, now);
      break;
    case "archive_keyword": q.setState.run("archived", c.entity_id); break;
  }
}

export async function runDeploy(ids: number[], user: string, opts: { acknowledgeLive?: boolean; expectedMode?: string }) {
  const unique = [...new Set(ids.map(Number))];
  if (!unique.length) throw new DeployError("Nothing selected to deploy.");
  if (unique.length > LIMITS.maxPerDeploy) throw new DeployError(`At most ${LIMITS.maxPerDeploy} changes per deploy — deploy in batches.`);
  const items = unique.map((id) => q.byId.get(id) as ChangeRow | undefined);
  if (items.some((c) => !c || c.status !== "staged")) throw new DeployError("Some selected changes aren't staged any more — refresh the queue.");
  const mode = deployMode();
  // The confirm dialog showed a mode; refuse if it changed underneath (e.g. .env edited).
  if (opts.expectedMode && opts.expectedMode !== mode) throw new DeployError(`Deploy mode is now "${mode}" — review again.`);
  if (mode === "live" && !opts.acknowledgeLive) throw new DeployError("Live deploy needs the explicit confirmation.");

  const rows = items as ChangeRow[];
  const est = rows.reduce((s, c) => s + (c.est_daily_cost_delta ?? 0), 0);
  const deployId = (q.insertDeploy.get(mode, user, new Date().toISOString(), rows.length, est) as { id: number }).id;
  const outcomes = new Map<number, Outcome>();

  // 1. Pre-checks
  const ready: ChangeRow[] = [];
  for (const c of rows) {
    const problem = precheck(c);
    if (problem) outcomes.set(c.id, { ok: false, message: problem });
    else ready.push(c);
  }

  // 2. Send (or simulate)
  if (mode === "live") {
    const writers: Writers = {
      kw: await import("../amazon-ads/keywordWrites.js"),
      tg: await import("../amazon-ads/targetWrites.js"),
      neg: await import("../amazon-ads/negativeWrites.js"),
    };
    for (const g of plan(ready)) {
      try {
        const res = await g.send(writers);
        g.items.forEach((c, i) => {
          const ok = res.success.find((s) => s.index === i);
          const err = res.error.find((e) => e.index === i);
          outcomes.set(c.id, ok ? { ok: true, message: "Deployed", amazonId: ok.id || c.entity_id || undefined }
            : { ok: false, message: err?.message ?? "Amazon didn't confirm this change" });
        });
      } catch (e) {
        for (const c of g.items) outcomes.set(c.id, { ok: false, message: (e as Error).message.slice(0, 500) });
      }
    }
  } else {
    for (const c of ready) {
      outcomes.set(c.id, mode === "demo"
        ? { ok: true, message: "Applied to demo data (not sent to Amazon)", amazonId: c.entity_id ?? `demo-${c.id}` }
        : { ok: true, message: "Dry run — not sent (AMAZON_ADS_WRITES_ENABLED is off)" });
    }
  }

  // 3. Record results + mirror successes locally
  let succeeded = 0;
  db.transaction(() => {
    for (const c of rows) {
      const o = outcomes.get(c.id)!;
      const status = !o.ok ? "failed" : mode === "live" ? "deployed" : mode === "demo" ? "demo_applied" : "dry_run";
      q.markResult.run(status, deployId, o.message, o.ok ? o.amazonId ?? null : null, c.id);
      if (o.ok) {
        succeeded++;
        if (mode !== "dry_run") applyLocally(c, o.amazonId ?? c.entity_id ?? undefined);
      }
    }
    q.finishDeploy.run(new Date().toISOString(), succeeded, rows.length - succeeded, deployId);
  })();

  return { deployId, mode, total: rows.length, succeeded, failed: rows.length - succeeded };
}
