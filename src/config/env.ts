import "dotenv/config";

/**
 * Central place that reads and validates environment variables.
 * Everything else in the codebase should import `env` from here rather
 * than touching `process.env` directly — keeps credential handling in one spot.
 */

type Region = "NA" | "EU" | "FE";

const REGION_HOSTS: Record<Region, { api: string; auth: string }> = {
  // Ads API base URLs per Amazon's docs — differ from the LWA token host,
  // which is the same (api.amazon.com) worldwide.
  NA: { api: "https://advertising-api.amazon.com", auth: "https://api.amazon.com/auth/o2/token" },
  EU: { api: "https://advertising-api-eu.amazon.com", auth: "https://api.amazon.com/auth/o2/token" },
  FE: { api: "https://advertising-api-fe.amazon.com", auth: "https://api.amazon.com/auth/o2/token" },
};

function required(name: string, allowEmptyDuringSetup = false): string {
  const value = process.env[name];
  if (!value && !allowEmptyDuringSetup) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in ` +
        `(see README.md "Getting Amazon Ads API access" for how).`
    );
  }
  return value ?? "";
}

const region = (process.env.AMAZON_ADS_REGION as Region) || "EU";
if (!REGION_HOSTS[region]) {
  throw new Error(`AMAZON_ADS_REGION must be one of NA, EU, FE — got "${region}"`);
}

export const env = {
  clientId: required("AMAZON_ADS_CLIENT_ID"),
  clientSecret: required("AMAZON_ADS_CLIENT_SECRET"),
  redirectUri: process.env.AMAZON_ADS_REDIRECT_URI || "http://localhost:3456/callback",

  // Allowed empty because these two are populated by the setup scripts themselves,
  // at which point .env gets updated and later runs will have them.
  refreshToken: required("AMAZON_ADS_REFRESH_TOKEN", true),
  profileId: required("AMAZON_ADS_PROFILE_ID", true),

  region,
  apiBaseUrl: REGION_HOSTS[region].api,
  authTokenUrl: REGION_HOSTS[region].auth,
};
