import { qs, useApi } from "../lib/api";
import type { CampaignsResponse, Range } from "../lib/types";

/** Campaign filter dropdown; reuses the (already cached) campaigns list for the range. */
export function CampaignSelect({ range, value, onChange }: { range: Range; value: string; onChange: (id: string) => void }) {
  const { data } = useApi<CampaignsResponse>(`/api/campaigns?${qs({ from: range.from, to: range.to })}`);
  const campaigns = data ? [...data.campaigns].sort((a, b) => a.name.localeCompare(b.name)) : [];
  return (
    <select className="campaign-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Campaign">
      <option value="">All campaigns</option>
      {campaigns.map((c) => <option key={c.campaignId} value={c.campaignId}>{c.name}</option>)}
    </select>
  );
}
