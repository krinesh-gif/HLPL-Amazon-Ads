import { db } from "../db/client.js";

/**
 * The "ready to deploy" queue (staging). Staging never talks to Amazon: it validates a
 * proposed change against the guardrails, records the current value it replaces and a
 * rough ₹/day impact, and waits for an explicit deploy (see deploy.ts).
 *
 * The server works out old values, labels and estimates itself from the synced data —
 * the browser only says *what* it wants changed.
 */

export const LIMITS = {
  minBid: 1,
  maxBid: 100,
  maxStep: 0.3, // max ±30% bid change per step (reverts are exempt)
  maxPerDeploy: 100,
  estimateDays: 14,
};

export type ChangeKind = "bid" | "state" | "negative" | "harvest" | "remove_negative" | "archive_keyword";

export type StageRequest =
  | { kind: "bid"; targetId: string; bid: number; reason?: string }
  | { kind: "state"; targetId: string; state: "enabled" | "paused"; reason?: string }
  | { kind: "negative"; searchTerm: string; campaignId: string; adGroupId: string; reason?: string }
  | { kind: "harvest"; searchTerm: string; campaignId: string; adGroupId: string; bid: number; reason?: string };

export class StageError extends Error {}

const ASIN_RE = /^b0[0-9a-z]{8}$/i;
const round2 = (n: number) => Math.round(n * 100) / 100;

const q = {
  target: db.prepare(`
    SELECT t.target_id AS targetId, t.kind, t.campaign_id AS campaignId, t.ad_group_id AS adGroupId, t.text,
           t.match_type AS matchType, t.state, t.bid, g.default_bid AS defaultBid
    FROM sp_targets t LEFT JOIN sp_ad_groups g ON g.ad_group_id = t.ad_group_id WHERE t.target_id = ?`),
  adGroup: db.prepare(`
    SELECT g.ad_group_id AS adGroupId, g.campaign_id AS campaignId, g.name, c.targeting_type AS targetingType, c.state AS campaignState
    FROM sp_ad_groups g JOIN sp_campaigns c ON c.campaign_id = g.campaign_id WHERE g.ad_group_id = ?`),
  maxTargetDate: db.prepare(`SELECT MAX(date) FROM sp_target_daily_metrics`).pluck(),
  maxTermDate: db.prepare(`SELECT MAX(date) FROM sp_search_term_daily_metrics`).pluck(),
  targetCost: db.prepare(`SELECT COALESCE(SUM(cost), 0) FROM sp_target_daily_metrics WHERE target_id = ? AND date > ? AND date <= ?`).pluck(),
  termCostInAdGroup: db.prepare(`
    SELECT COALESCE(SUM(cost), 0) FROM sp_search_term_daily_metrics
    WHERE search_term = ? AND ad_group_id = ? AND date > ? AND date <= ?`).pluck(),
  termCost: db.prepare(`SELECT COALESCE(SUM(cost), 0) FROM sp_search_term_daily_metrics WHERE search_term = ? AND date > ? AND date <= ?`).pluck(),
  termCpc: db.prepare(`SELECT CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) END FROM sp_search_term_daily_metrics WHERE search_term = ?`).pluck(),
  negativeExists: db.prepare(`SELECT 1 FROM sp_negative_keywords WHERE ad_group_id = ? AND text = ? AND match_type IN ('negative_exact', 'negative_asin')`).pluck(),
  keywordExists: db.prepare(`SELECT 1 FROM sp_targets WHERE ad_group_id = ? AND lower(text) = ? AND state != 'archived' AND (match_type = 'exact' OR kind = 'product')`).pluck(),
  insert: db.prepare(`
    INSERT INTO change_queue (kind, status, entity_key, target_kind, entity_id, campaign_id, ad_group_id, label,
      old_value, new_value, est_daily_cost_delta, reason, source, revert_of, created_by, created_at)
    VALUES (@kind, 'staged', @entityKey, @targetKind, @entityId, @campaignId, @adGroupId, @label,
      @oldValue, @newValue, @est, @reason, @source, @revertOf, @createdBy, @createdAt)
    ON CONFLICT(entity_key) WHERE status = 'staged' DO UPDATE SET
      new_value = excluded.new_value, old_value = excluded.old_value, est_daily_cost_delta = excluded.est_daily_cost_delta,
      reason = excluded.reason, created_by = excluded.created_by, created_at = excluded.created_at
    RETURNING id`),
  get: db.prepare(`SELECT * FROM change_queue WHERE id = ?`),
  discard: db.prepare(`UPDATE change_queue SET status = 'discarded' WHERE id = ? AND status = 'staged'`),
  hasRevert: db.prepare(`SELECT 1 FROM change_queue WHERE revert_of = ? AND status NOT IN ('discarded', 'failed')`).pluck(),
  listStaged: db.prepare(`
    SELECT q.*, c.name AS campaignName, g.name AS adGroupName FROM change_queue q
    LEFT JOIN sp_campaigns c ON c.campaign_id = q.campaign_id
    LEFT JOIN sp_ad_groups g ON g.ad_group_id = q.ad_group_id
    WHERE q.status = 'staged' ORDER BY q.id`),
  listForDeploy: db.prepare(`
    SELECT q.*, c.name AS campaignName, g.name AS adGroupName FROM change_queue q
    LEFT JOIN sp_campaigns c ON c.campaign_id = q.campaign_id
    LEFT JOIN sp_ad_groups g ON g.ad_group_id = q.ad_group_id
    WHERE q.deploy_id = ? ORDER BY q.id`),
  deploys: db.prepare(`SELECT id, mode, deployed_by AS deployedBy, started_at AS startedAt, finished_at AS finishedAt,
    total, succeeded, failed, est_daily_cost_delta AS estDailyCostDelta FROM deploys ORDER BY id DESC LIMIT ?`),
  revertedIds: db.prepare(`SELECT revert_of FROM change_queue WHERE revert_of IS NOT NULL AND status NOT IN ('discarded', 'failed')`).pluck(),
};

/** Average daily spend over the estimate window, ending at the last synced day. */
function avgDaily(stmt: "target" | "termInAdGroup" | "term", ...args: string[]): number {
  const maxDate = (stmt === "target" ? q.maxTargetDate.get() : q.maxTermDate.get()) as string | null;
  if (!maxDate) return 0;
  const from = new Date(Date.parse(`${maxDate}T00:00:00Z`) - LIMITS.estimateDays * 86_400_000).toISOString().slice(0, 10);
  const total =
    stmt === "target" ? q.targetCost.get(args[0], from, maxDate)
    : stmt === "termInAdGroup" ? q.termCostInAdGroup.get(args[0], args[1], from, maxDate)
    : q.termCost.get(args[0], from, maxDate);
  return (total as number) / LIMITS.estimateDays;
}

interface TargetRow {
  targetId: string; kind: string; campaignId: string; adGroupId: string; text: string;
  matchType: string | null; state: string; bid: number | null; defaultBid: number | null;
}

function loadTarget(id: string): TargetRow {
  const t = q.target.get(id) as TargetRow | undefined;
  if (!t) throw new StageError("That keyword/target isn't in the synced data — run npm run sync:keywords.");
  if (t.state === "archived") throw new StageError("Archived keywords/targets can't be changed.");
  return t;
}

export function checkBid(newBid: number, currentBid: number | null, isRevert = false): void {
  if (!Number.isFinite(newBid)) throw new StageError("Bid must be a number.");
  if (newBid < LIMITS.minBid || newBid > LIMITS.maxBid) {
    throw new StageError(`Bid must be between ₹${LIMITS.minBid} and ₹${LIMITS.maxBid}.`);
  }
  if (currentBid != null && !isRevert) {
    const step = newBid / currentBid - 1;
    if (Math.abs(step) > LIMITS.maxStep + 1e-9) {
      throw new StageError(
        `That's a ${Math.round(step * 100)}% change — the limit is ±${LIMITS.maxStep * 100}% per step ` +
          `(₹${round2(currentBid * (1 - LIMITS.maxStep))}–₹${round2(currentBid * (1 + LIMITS.maxStep))}).`
      );
    }
    if (round2(newBid) === round2(currentBid)) throw new StageError("That's the current bid already.");
  }
}

export function stageChange(req: StageRequest, user: string): number {
  const base = { reason: req.reason?.slice(0, 300) ?? null, source: "keywords", revertOf: null, createdBy: user, createdAt: new Date().toISOString() };

  if (req.kind === "bid" || req.kind === "state") {
    const t = loadTarget(String(req.targetId));
    const common = { targetKind: t.kind, entityId: t.targetId, campaignId: t.campaignId, adGroupId: t.adGroupId, label: t.text };
    if (req.kind === "bid") {
      const current = t.bid ?? t.defaultBid;
      const bid = round2(Number(req.bid));
      checkBid(bid, current);
      const est = current ? avgDaily("target", t.targetId) * (bid / current - 1) : null;
      return (q.insert.get({ ...base, ...common, kind: "bid", entityKey: `bid:${t.targetId}`,
        oldValue: JSON.stringify({ bid: current, bidIsDefault: t.bid == null }), newValue: JSON.stringify({ bid }), est }) as { id: number }).id;
    }
    if (req.state !== "enabled" && req.state !== "paused") throw new StageError("State must be enabled or paused.");
    if (t.state === req.state) throw new StageError(`It's already ${req.state}.`);
    const daily = avgDaily("target", t.targetId);
    return (q.insert.get({ ...base, ...common, kind: "state", entityKey: `state:${t.targetId}`,
      oldValue: JSON.stringify({ state: t.state }), newValue: JSON.stringify({ state: req.state }),
      est: req.state === "paused" ? -daily : daily }) as { id: number }).id;
  }

  const term = String(req.searchTerm ?? "").trim().toLowerCase();
  if (!term || term.length > 80) throw new StageError("Search term must be 1–80 characters.");
  const g = q.adGroup.get(String(req.adGroupId)) as { adGroupId: string; campaignId: string; name: string; targetingType: string; campaignState: string } | undefined;
  if (!g || g.campaignId !== String(req.campaignId)) throw new StageError("Unknown campaign / ad group.");
  const isAsin = ASIN_RE.test(term);
  const common = { ...base, source: "search-terms", targetKind: isAsin ? "asin" : "keyword", entityId: null, campaignId: g.campaignId, adGroupId: g.adGroupId, label: term };

  if (req.kind === "negative") {
    if (q.negativeExists.get(g.adGroupId, term)) throw new StageError("Already negated in that ad group.");
    return (q.insert.get({ ...common, kind: "negative", entityKey: `negative:${g.adGroupId}:${term}`,
      oldValue: null, newValue: JSON.stringify({ text: term, matchType: isAsin ? "negative_asin" : "negative_exact" }),
      est: -avgDaily("termInAdGroup", term, g.adGroupId) }) as { id: number }).id;
  }

  if (req.kind === "harvest") {
    if (g.targetingType !== "manual") throw new StageError("Harvest into a manual-targeting campaign's ad group.");
    if (q.keywordExists.get(g.adGroupId, isAsin ? `asin="${term}"` : term)) throw new StageError("That ad group already targets it.");
    const bid = round2(Number(req.bid));
    checkBid(bid, null);
    return (q.insert.get({ ...common, kind: "harvest", entityKey: `harvest:${g.adGroupId}:${term}`,
      oldValue: null, newValue: JSON.stringify({ text: term, bid, as: isAsin ? "asin_target" : "exact_keyword" }),
      // Upper bound: a new exact keyword mostly moves this term's traffic from the source target.
      est: avgDaily("term", term) }) as { id: number }).id;
  }
  throw new StageError("Unknown change type.");
}

export function suggestedHarvestBid(term: string): number | null {
  const cpc = q.termCpc.get(term.toLowerCase()) as number | null;
  return cpc ? Math.min(LIMITS.maxBid, Math.max(LIMITS.minBid, round2(cpc))) : null;
}

export function discardChange(id: number): boolean {
  return q.discard.run(id).changes > 0;
}

/** Puts the reverse of a deployed change into the queue. Nothing is undone until that is deployed too. */
export function stageRevert(id: number, user: string): number {
  const c = q.get.get(id) as ChangeRow | undefined;
  if (!c) throw new StageError("Change not found.");
  if (c.status !== "deployed" && c.status !== "demo_applied") throw new StageError("Only deployed changes can be reverted.");
  if (q.hasRevert.get(id)) throw new StageError("A revert for this change already exists.");
  const oldV = c.old_value ? JSON.parse(c.old_value) : null;
  const base = { reason: `Revert of change #${id}`, source: "revert", revertOf: id, createdBy: user, createdAt: new Date().toISOString(),
    targetKind: c.target_kind, campaignId: c.campaign_id, adGroupId: c.ad_group_id, label: c.label,
    est: c.est_daily_cost_delta != null ? -c.est_daily_cost_delta : null };

  if (c.kind === "bid" || c.kind === "state") {
    const t = loadTarget(c.entity_id!);
    if (c.kind === "bid") {
      const current = t.bid ?? t.defaultBid;
      checkBid(oldV.bid, current, true);
      return (q.insert.get({ ...base, kind: "bid", entityKey: `bid:${t.targetId}`, entityId: t.targetId,
        oldValue: JSON.stringify({ bid: current }), newValue: JSON.stringify({ bid: oldV.bid }) }) as { id: number }).id;
    }
    return (q.insert.get({ ...base, kind: "state", entityKey: `state:${t.targetId}`, entityId: t.targetId,
      oldValue: JSON.stringify({ state: t.state }), newValue: JSON.stringify({ state: oldV.state }) }) as { id: number }).id;
  }
  if (!c.entity_id) throw new StageError("Amazon didn't return an id for this change, so it can't be reverted from here.");
  if (c.kind === "negative") {
    return (q.insert.get({ ...base, kind: "remove_negative", entityKey: `remove_negative:${c.entity_id}`, entityId: c.entity_id,
      oldValue: c.new_value, newValue: JSON.stringify({ removed: true }) }) as { id: number }).id;
  }
  if (c.kind === "harvest") {
    return (q.insert.get({ ...base, kind: "archive_keyword", entityKey: `archive:${c.entity_id}`, entityId: c.entity_id,
      oldValue: c.new_value, newValue: JSON.stringify({ archived: true }) }) as { id: number }).id;
  }
  throw new StageError("Reverts of reverts aren't supported — stage the change again from its screen.");
}

export interface ChangeRow {
  id: number; kind: ChangeKind; status: string; entity_key: string; target_kind: string | null; entity_id: string | null;
  campaign_id: string; ad_group_id: string; label: string; old_value: string | null; new_value: string;
  est_daily_cost_delta: number | null; reason: string | null; source: string; revert_of: number | null;
  created_by: string; created_at: string; deploy_id: number | null; result_message: string | null;
  campaignName?: string | null; adGroupName?: string | null;
}

export function toApi(r: ChangeRow, reverted?: Set<number>) {
  return {
    id: r.id, kind: r.kind, status: r.status, targetKind: r.target_kind, entityId: r.entity_id,
    entityKey: r.entity_key, campaignId: r.campaign_id, adGroupId: r.ad_group_id,
    campaignName: r.campaignName ?? null, adGroupName: r.adGroupName ?? null, label: r.label,
    oldValue: r.old_value ? JSON.parse(r.old_value) : null, newValue: JSON.parse(r.new_value),
    estDailyCostDelta: r.est_daily_cost_delta, reason: r.reason, source: r.source, revertOf: r.revert_of,
    createdBy: r.created_by, createdAt: r.created_at, deployId: r.deploy_id, resultMessage: r.result_message,
    reverted: reverted ? reverted.has(r.id) : undefined,
  };
}

export function listStaged() {
  const rows = (q.listStaged.all() as ChangeRow[]).map((r) => toApi(r));
  return {
    changes: rows,
    estDailyCostDelta: rows.reduce((s, r) => s + (r.estDailyCostDelta ?? 0), 0),
    limits: LIMITS,
  };
}

export function listDeploys(limit = 20) {
  const reverted = new Set(q.revertedIds.all() as number[]);
  return (q.deploys.all(limit) as { id: number }[]).map((d) => ({
    ...d,
    changes: (q.listForDeploy.all(d.id) as ChangeRow[]).map((r) => toApi(r, reverted)),
  }));
}
