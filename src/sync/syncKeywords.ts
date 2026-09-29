import { listSpAdGroups } from "../amazon-ads/adGroups.js";
import { listSpKeywords } from "../amazon-ads/keywords.js";
import { listSpCampaignNegativeKeywords, listSpNegativeKeywords } from "../amazon-ads/negativeKeywords.js";
import { describeExpression, listSpTargets } from "../amazon-ads/targets.js";
import { db, initSchema } from "../db/client.js";

/**
 * Pulls current structure below campaigns: ad groups, keywords, product/auto targets and
 * negative keywords. Settings only (bids, states) — performance comes from the reports.
 */
export async function syncKeywords(): Promise<number> {
  initSchema();
  const [adGroups, keywords, targets, negatives, campaignNegatives] = await Promise.all([
    listSpAdGroups(),
    listSpKeywords(),
    listSpTargets(),
    listSpNegativeKeywords(),
    listSpCampaignNegativeKeywords(),
  ]);
  const syncedAt = new Date().toISOString();

  const upsertAdGroup = db.prepare(`
    INSERT INTO sp_ad_groups (ad_group_id, campaign_id, name, state, default_bid, synced_at)
    VALUES (@adGroupId, @campaignId, @name, @state, @defaultBid, @syncedAt)
    ON CONFLICT(ad_group_id) DO UPDATE SET
      campaign_id = excluded.campaign_id, name = excluded.name, state = excluded.state,
      default_bid = excluded.default_bid, synced_at = excluded.synced_at`);
  const upsertTarget = db.prepare(`
    INSERT INTO sp_targets (target_id, kind, campaign_id, ad_group_id, text, match_type, state, bid, synced_at)
    VALUES (@targetId, @kind, @campaignId, @adGroupId, @text, @matchType, @state, @bid, @syncedAt)
    ON CONFLICT(target_id) DO UPDATE SET
      kind = excluded.kind, campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id,
      text = excluded.text, match_type = excluded.match_type, state = excluded.state,
      bid = excluded.bid, synced_at = excluded.synced_at`);
  const insertNegative = db.prepare(`
    INSERT INTO sp_negative_keywords (negative_id, campaign_id, ad_group_id, text, match_type, synced_at)
    VALUES (@id, @campaignId, @adGroupId, @text, @matchType, @syncedAt)`);

  db.transaction(() => {
    for (const g of adGroups) {
      upsertAdGroup.run({ ...g, state: g.state.toLowerCase(), defaultBid: g.defaultBid ?? null, syncedAt });
    }
    for (const k of keywords) {
      upsertTarget.run({
        targetId: k.keywordId, kind: "keyword", campaignId: k.campaignId, adGroupId: k.adGroupId,
        text: k.keywordText, matchType: k.matchType.toLowerCase(), state: k.state.toLowerCase(),
        bid: k.bid ?? null, syncedAt,
      });
    }
    for (const t of targets) {
      upsertTarget.run({
        targetId: t.targetId, kind: t.expressionType === "AUTO" ? "auto" : "product",
        campaignId: t.campaignId, adGroupId: t.adGroupId,
        text: describeExpression(t.resolvedExpression ?? t.expression), matchType: null,
        state: t.state.toLowerCase(), bid: t.bid ?? null, syncedAt,
      });
    }
    // Negatives are replaced wholesale: removed ones must disappear, not linger.
    db.exec(`DELETE FROM sp_negative_keywords`);
    for (const n of [...negatives, ...campaignNegatives]) {
      insertNegative.run({
        id: `${n.adGroupId ? "ag" : "c"}-${n.keywordId}`, campaignId: n.campaignId, adGroupId: n.adGroupId ?? null,
        text: n.keywordText.toLowerCase(), matchType: n.matchType.toLowerCase(), syncedAt,
      });
    }
  })();

  const total = adGroups.length + keywords.length + targets.length + negatives.length + campaignNegatives.length;
  console.log(
    `Synced ${adGroups.length} ad groups, ${keywords.length} keywords, ${targets.length} targets, ` +
      `${negatives.length + campaignNegatives.length} negative keywords into ${db.name}.`
  );
  return total;
}
