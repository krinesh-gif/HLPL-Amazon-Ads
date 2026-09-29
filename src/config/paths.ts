import "dotenv/config";

/**
 * Local paths that don't depend on Amazon credentials. Kept separate from
 * env.ts so the read-only dashboard server (which only reads SQLite) can boot
 * without AMAZON_ADS_CLIENT_ID/SECRET, while anything that calls Amazon still
 * fails fast through env.ts's eager validation.
 */
export const dbPath = process.env.DB_PATH || "./data/aravi-ads.sqlite";
