export interface Totals {
  cost: number;
  sales: number;
  impressions: number;
  clicks: number;
  orders: number;
}
export interface DailyPoint extends Totals {
  date: string;
}
export interface Range {
  from: string;
  to: string;
}
export interface Meta {
  dataSource: "demo" | "live" | "empty";
  minDate: string | null;
  maxDate: string | null;
  profile: { profileId: string; countryCode: string; currencyCode: string; accountName: string | null } | null;
  counts: { campaigns: number; dailyRows: number; targets: number; searchTermRows: number };
  searchTerms: { minDate: string | null; maxDate: string | null };
  adProducts: AdProduct[];
}
export interface Overview {
  range: Range;
  previousRange: Range;
  current: Totals;
  previous: Totals;
  daily: DailyPoint[];
  previousDaily: DailyPoint[];
  byProduct: (Totals & { adProduct: AdProduct })[];
  previousByProduct: (Totals & { adProduct: AdProduct })[];
}
export type AdProduct = "sp" | "sb" | "sd";

export interface CampaignRow extends Totals {
  adProduct: AdProduct;
  campaignId: string;
  name: string;
  state: string | null;
  targetingType: string | null;
  dailyBudget: number | null;
  prevCost: number;
  prevSales: number;
  budgetCappedDays: number;
  activeDays: number;
}
export interface CampaignsResponse {
  range: Range;
  previousRange: Range;
  campaigns: CampaignRow[];
}
export interface CampaignDetail {
  range: Range;
  previousRange: Range;
  campaign: {
    adProduct: AdProduct;
    campaignId: string;
    name: string;
    state?: string;
    targetingType?: string;
    dailyBudget?: number;
    startDate?: string;
    endDate?: string | null;
    syncedAt?: string;
  };
  current: Totals;
  previous: Totals;
  daily: DailyPoint[];
}
export interface SyncRun {
  id?: number;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  rowsSynced: number | null;
  detail: string | null;
}
export interface SyncStatus {
  lastRuns: SyncRun[];
  lastSuccess: { job: string; finishedAt: string }[];
  recentRuns: SyncRun[];
  counts: { campaigns: number; dailyRows: number };
}

export interface SearchTermRow extends Totals {
  key: string;
  searchTerm: string;
  isAsin: boolean;
  campaignId: string;
  campaignName: string | null;
  adGroupId: string;
  adGroupName: string | null;
  sourceText: string | null;
  sourceKind: string | null;
  matchType: string | null;
  sourceCount: number;
  hasExactKeyword: boolean;
  negated: boolean;
  action: null | { type: "harvest" | "negate"; label: string; reason: string };
}
export interface SearchTermsResponse {
  range: Range;
  counts: { all: number; harvest: number; negate: number };
  total: number;
  totals: Totals;
  rows: SearchTermRow[];
}
export interface TargetRow extends Totals {
  targetId: string;
  kind: "keyword" | "product" | "auto";
  text: string;
  matchType: string | null;
  state: string | null;
  campaignId: string;
  campaignName: string | null;
  adGroupId: string;
  adGroupName: string | null;
  bid: number | null;
  bidIsDefault: boolean;
  suggestedBid: number | null;
  suggestion: string;
}
export interface TargetsResponse {
  range: Range;
  accountCvr: number;
  rows: TargetRow[];
}
