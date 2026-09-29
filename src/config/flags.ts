import "dotenv/config";

/**
 * Live writes to Amazon are OFF unless AMAZON_ADS_WRITES_ENABLED=true is set in .env.
 * With it off, "Deploy" runs as a dry run: it validates and records exactly what it
 * would send, and sends nothing. Demo databases are never written to Amazon regardless.
 */
export const writesEnabled = process.env.AMAZON_ADS_WRITES_ENABLED === "true";
