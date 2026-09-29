import { SEVERITY_LABEL, type Insight } from "../lib/insights";
import { campaignHref } from "../lib/adProducts";
import type { Range } from "../lib/types";

const ICON: Record<Insight["severity"], string> = {
  critical: "M12 8v5m0 3h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  serious: "M12 8v5m0 3h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  warning: "M12 8v4l2.5 2.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  good: "M4 17l6-6 4 4 6-7M14 8h6v6",
};

export function InsightItem({ insight, range }: { insight: Insight; range: Range }) {
  return (
    <li className={`insight sev-${insight.severity}`}>
      <span className="sev-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24"><path d={ICON[insight.severity]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <div className="insight-body">
        <div className="insight-top">
          <span className="sev-label">{SEVERITY_LABEL[insight.severity]} · {insight.kind}</span>
        </div>
        <a className="insight-campaign" href={campaignHref(insight.campaign, range)}>
          {insight.campaign.name}
        </a>
        <p className="insight-title">{insight.title}</p>
        <p className="muted small">{insight.detail}</p>
      </div>
    </li>
  );
}
