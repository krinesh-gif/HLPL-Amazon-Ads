import { adsApiFetch } from "./client.js";

/**
 * Amazon Ads Reporting API v3 — this is how you get performance numbers
 * (impressions, clicks, spend, sales, ACOS...) as opposed to campaign settings.
 * It's async: you request a report, poll until it's ready, then download a
 * gzipped JSON file from a signed URL. Budget for this taking anywhere from
 * a few seconds to a few minutes.
 */

export interface ReportRequest {
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  configuration: {
    adProduct: "SPONSORED_PRODUCTS" | "SPONSORED_BRANDS" | "SPONSORED_DISPLAY";
    groupBy: string[]; // e.g. ["campaign"] or ["campaign", "adGroup"]
    columns: string[]; // e.g. ["impressions", "clicks", "cost", "sales14d", "purchases14d"]
    reportTypeId: string; // e.g. "spCampaigns"
    timeUnit: "SUMMARY" | "DAILY";
    format: "GZIP_JSON";
  };
}

interface ReportStatusResponse {
  reportId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  url?: string; // present once status === "COMPLETED"
  failureReason?: string;
}

export async function requestReport(request: ReportRequest): Promise<string> {
  const result = await adsApiFetch<{ reportId: string }>("/reporting/reports", {
    method: "POST",
    body: request,
    headers: {
      "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
    },
  });
  return result.reportId;
}

export async function getReportStatus(reportId: string): Promise<ReportStatusResponse> {
  return adsApiFetch<ReportStatusResponse>(`/reporting/reports/${reportId}`);
}

/** Polls until the report is done (or failed), then returns the download URL. */
export async function waitForReport(
  reportId: string,
  { intervalMs = 5000, timeoutMs = 5 * 60 * 1000 } = {}
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getReportStatus(reportId);
    if (status.status === "COMPLETED" && status.url) return status.url;
    if (status.status === "FAILED") {
      throw new Error(`Report ${reportId} failed: ${status.failureReason ?? "unknown reason"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Report ${reportId} did not finish within ${timeoutMs}ms`);
}

/** Downloads and decompresses the finished report into plain JSON rows. */
export async function downloadReport<T = Record<string, unknown>>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Report download failed (${res.status})`);
  const { gunzipSync } = await import("node:zlib");
  const buffer = Buffer.from(await res.arrayBuffer());
  const json = gunzipSync(buffer).toString("utf-8");
  return JSON.parse(json) as T[];
}

/** Convenience: request a standard SP campaign daily-performance report for a date range. */
export function spCampaignDailyReportRequest(startDate: string, endDate: string): ReportRequest {
  return {
    name: `sp-campaigns-daily-${startDate}-to-${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["campaign"],
      columns: [
        "date",
        "campaignId",
        "campaignName",
        "impressions",
        "clicks",
        "cost",
        "sales14d",
        "purchases14d",
      ],
      reportTypeId: "spCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

/** Request → poll → download in one call. */
export async function runReport<T>(request: ReportRequest): Promise<T[]> {
  const reportId = await requestReport(request);
  console.log(`  report ${request.name} requested (id=${reportId}), waiting...`);
  return downloadReport<T>(await waitForReport(reportId));
}

/**
 * Daily performance per keyword / product target / auto-target group.
 * `keywordId` in this report is the keywordId for keywords and the targetId for targets.
 * Column names follow Amazon's v3 spTargeting docs — not yet verified against the live
 * API from this repo (no credentials yet); check the first real run.
 */
export function spTargetingDailyReportRequest(startDate: string, endDate: string): ReportRequest {
  return {
    name: `sp-targeting-daily-${startDate}-to-${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["targeting"],
      columns: [
        "date", "campaignId", "adGroupId", "keywordId", "keyword", "keywordType", "matchType",
        "targeting", "impressions", "clicks", "cost", "sales14d", "purchases14d",
      ],
      reportTypeId: "spTargeting",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

/**
 * Daily performance per customer search term, per keyword/target that matched it.
 * Amazon only keeps search-term data for a limited window (roughly the last 60–90 days),
 * so sync it regularly. Same caveat as above on column names.
 */
export function spSearchTermDailyReportRequest(startDate: string, endDate: string): ReportRequest {
  return {
    name: `sp-search-terms-daily-${startDate}-to-${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["searchTerm"],
      columns: [
        "date", "campaignId", "adGroupId", "keywordId", "keyword", "keywordType", "matchType",
        "targeting", "searchTerm", "impressions", "clicks", "cost", "sales14d", "purchases14d",
      ],
      reportTypeId: "spSearchTerm",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

/**
 * Daily Sponsored Brands campaign performance. SB and SD name their attributed metrics
 * `sales` / `purchases` (SP uses `sales14d` / `purchases14d`); both are 14-day windows,
 * and SD's also counts view-through conversions.
 */
export function sbCampaignDailyReportRequest(startDate: string, endDate: string): ReportRequest {
  return {
    name: `sb-campaigns-daily-${startDate}-to-${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_BRANDS",
      groupBy: ["campaign"],
      columns: ["date", "campaignId", "campaignName", "impressions", "clicks", "cost", "sales", "purchases"],
      reportTypeId: "sbCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

/** Daily Sponsored Display campaign performance (see note on sbCampaignDailyReportRequest). */
export function sdCampaignDailyReportRequest(startDate: string, endDate: string): ReportRequest {
  return {
    name: `sd-campaigns-daily-${startDate}-to-${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_DISPLAY",
      groupBy: ["campaign"],
      columns: ["date", "campaignId", "campaignName", "impressions", "clicks", "cost", "sales", "purchases"],
      reportTypeId: "sdCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

/**
 * Daily SP performance per advertised product (ASIN) — product-level ad spend and sales.
 * Same caveat as the other v3 report builders: columns from Amazon's docs, unverified live.
 */
export function spAdvertisedProductDailyReportRequest(startDate: string, endDate: string): ReportRequest {
  return {
    name: `sp-advertised-product-daily-${startDate}-to-${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["advertiser"],
      columns: [
        "date", "campaignId", "adGroupId", "advertisedAsin", "advertisedSku",
        "impressions", "clicks", "cost", "sales14d", "purchases14d",
      ],
      reportTypeId: "spAdvertisedProduct",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}
