import type { AdProduct, CampaignRow, Range } from "./types";
import { href } from "./router";

export const AD_LABEL: Record<AdProduct, string> = {
  sp: "Sponsored Products",
  sb: "Sponsored Brands",
  sd: "Sponsored Display",
};
export const AD_SHORT: Record<AdProduct, string> = { sp: "SP", sb: "SB", sd: "SD" };
/** Fixed per ad type (never by rank), so SP is always the same color whatever is filtered. */
export const AD_COLOR: Record<AdProduct, string> = {
  sp: "var(--series-1)",
  sb: "var(--series-2)",
  sd: "var(--series-3)",
};
export const AD_ORDER: AdProduct[] = ["sp", "sb", "sd"];

/** Link to a campaign's detail page; `type` disambiguates the ad product. */
export function campaignHref(c: { campaignId: string; adProduct: AdProduct }, range: Range): string {
  return href(`/campaigns/${encodeURIComponent(c.campaignId)}`, { ...range, type: c.adProduct });
}
export function campaignApi(c: Pick<CampaignRow, "campaignId" | "adProduct">, range: Range): string {
  return `/api/campaigns/${encodeURIComponent(c.campaignId)}?${new URLSearchParams({ ...range, ad: c.adProduct })}`;
}
