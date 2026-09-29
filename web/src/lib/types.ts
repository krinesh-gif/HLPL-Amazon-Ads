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

export type DeployMode = "live" | "dry_run" | "demo";
export type ChangeKind = "bid" | "state" | "negative" | "harvest" | "remove_negative" | "archive_keyword";
export interface Change {
  id: number;
  kind: ChangeKind;
  status: "staged" | "deployed" | "demo_applied" | "dry_run" | "failed" | "discarded";
  targetKind: string | null;
  entityId: string | null;
  entityKey: string;
  campaignId: string;
  adGroupId: string;
  campaignName: string | null;
  adGroupName: string | null;
  label: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown>;
  estDailyCostDelta: number | null;
  reason: string | null;
  source: string;
  revertOf: number | null;
  createdBy: string;
  createdAt: string;
  deployId: number | null;
  resultMessage: string | null;
  reverted?: boolean;
}
export interface Limits {
  minBid: number;
  maxBid: number;
  maxStep: number;
  maxPerDeploy: number;
  estimateDays: number;
}
export interface ChangesResponse {
  changes: Change[];
  estDailyCostDelta: number;
  limits: Limits;
  mode: DeployMode;
}
export interface Deploy {
  id: number;
  mode: DeployMode;
  deployedBy: string;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  succeeded: number;
  failed: number;
  estDailyCostDelta: number | null;
  changes: Change[];
}
export interface StageResult {
  staged: number[];
  errors: { index: number; error: string }[];
}

export interface ProductRow {
  asin: string;
  sku: string | null;
  title: string | null;
  productGroup: string | null;
  mrp: number | null;
  sellingPrice: number | null;
  unitCost: number | null;
  status: string;
  source: string;
  inCatalogue: boolean;
  spCost: number;
  spSales: number;
  sbCost: number;
  sbSales: number;
  adCost: number;
  adSales: number;
  adOrders: number;
  clicks: number;
  totalSales: number | null;
  units: number | null;
  sessions: number | null;
  breakEvenAcos: number | null;
}
export interface ProductsResponse {
  range: Range;
  feePct: number;
  rows: ProductRow[];
  unattributed: { sb: { cost: number; sales: number }; sd: { cost: number; sales: number } };
  businessReport: { coveredDays: number; rangeDays: number };
}
export interface SbMapperCampaign {
  campaignId: string;
  name: string;
  state: string;
  cost: number;
  sales: number;
  orders: number;
  mapped: { asin: string; weight: number; updatedBy: string; updatedAt: string }[];
  suggestions: { asin: string; score: number }[];
}
export interface SbMapperResponse {
  range: Range;
  campaigns: SbMapperCampaign[];
  products: { asin: string; title: string | null; productGroup: string | null; sku: string | null }[];
  summary: { campaigns: number; mapped: number; totalCost: number; mappedCost: number };
}
