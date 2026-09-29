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
  counts: { campaigns: number; dailyRows: number };
}
export interface Overview {
  range: Range;
  previousRange: Range;
  current: Totals;
  previous: Totals;
  daily: DailyPoint[];
  previousDaily: DailyPoint[];
}
export interface CampaignRow extends Totals {
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
