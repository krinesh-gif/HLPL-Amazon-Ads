import { adsApiFetch } from "./client.js";

export interface AdsProfile {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  accountInfo: { marketplaceStringId: string; id: string; type: string; name?: string };
}

/**
 * Lists every advertising profile the connected Amazon user can access —
 * a profile = one marketplace (e.g. Amazon.in) for one seller/vendor account.
 * This call is what AMAZON_ADS_PROFILE_ID gets filled in from; it's the only
 * endpoint that doesn't need the Amazon-Advertising-API-Scope header.
 */
export async function listProfiles(): Promise<AdsProfile[]> {
  return adsApiFetch<AdsProfile[]>("/v2/profiles", { needsProfile: false });
}
