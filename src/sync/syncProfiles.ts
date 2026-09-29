import { listProfiles } from "../amazon-ads/profiles.js";
import { db, initSchema } from "../db/client.js";

/** Lists profiles from Amazon and prints them — this is a lookup step, not really an ongoing sync. */
export async function syncProfiles(): Promise<number> {
  initSchema();
  const profiles = await listProfiles();

  const upsert = db.prepare(`
    INSERT INTO profiles (profile_id, country_code, currency_code, account_name, account_type, synced_at)
    VALUES (@profileId, @countryCode, @currencyCode, @accountName, @accountType, @syncedAt)
    ON CONFLICT(profile_id) DO UPDATE SET
      country_code = excluded.country_code,
      currency_code = excluded.currency_code,
      account_name = excluded.account_name,
      account_type = excluded.account_type,
      synced_at = excluded.synced_at
  `);

  const syncedAt = new Date().toISOString();
  console.log(`\nFound ${profiles.length} profile(s):\n`);
  for (const p of profiles) {
    upsert.run({
      profileId: String(p.profileId),
      countryCode: p.countryCode,
      currencyCode: p.currencyCode,
      accountName: p.accountInfo.name ?? null,
      accountType: p.accountInfo.type,
      syncedAt,
    });
    console.log(
      `  profileId=${p.profileId}  country=${p.countryCode}  currency=${p.currencyCode}  ` +
        `type=${p.accountInfo.type}  name="${p.accountInfo.name ?? ""}"`
    );
  }
  console.log(
    `\nPut the one for India / Aravi's account into .env as AMAZON_ADS_PROFILE_ID, then re-run other sync commands.\n`
  );
  return profiles.length;
}
