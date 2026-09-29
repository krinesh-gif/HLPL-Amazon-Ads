import { listAllV3 } from "./client.js";

/**
 * Sponsored Products product ads: which ASIN/SKU each ad group advertises. This is how
 * the product catalogue discovers your ASINs and ties SP campaigns to products.
 */
export interface SpProductAd {
  adId: string;
  campaignId: string;
  adGroupId: string;
  asin?: string;
  sku?: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
}

const CONTENT_TYPE = "application/vnd.spProductAd.v3+json";

export async function listSpProductAds(): Promise<SpProductAd[]> {
  return listAllV3<SpProductAd>("/sp/productAds/list", CONTENT_TYPE, "productAds", {
    stateFilter: { include: ["ENABLED", "PAUSED"] },
  });
}
