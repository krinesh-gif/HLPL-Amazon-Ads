import { useEffect, useState } from "react";
import { DateRangePicker } from "./components/DateRangePicker";
import { ErrorBox } from "./components/Ui";
import { useApi } from "./lib/api";
import { presetRange, yesterday } from "./lib/dates";
import { fmtDay } from "./lib/format";
import { usePref } from "./lib/prefs";
import { href, navigate, useRoute } from "./lib/router";
import type { Meta, Range } from "./lib/types";
import { CampaignDetailPage } from "./pages/CampaignDetail";
import { CampaignsPage } from "./pages/Campaigns";
import { InsightsPage } from "./pages/Insights";
import { KeywordsPage } from "./pages/Keywords";
import { SearchTermsPage } from "./pages/SearchTerms";
import { OverviewPage } from "./pages/Overview";
import { SyncPage } from "./pages/Sync";

export interface PageProps {
  range: Range;
  meta: Meta;
  targetAcos: number;
  params: URLSearchParams;
}

const NAV = [
  { path: "/", label: "Overview", icon: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" },
  { path: "/campaigns", label: "Campaigns", icon: "M4 6h16M4 12h16M4 18h10" },
  { path: "/keywords", label: "Keywords", icon: "M4 7h16M4 12h10M4 17h7M17 14l3 3-3 3" },
  { path: "/search-terms", label: "Search terms", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" },
  { path: "/insights", label: "Insights", icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" },
  { path: "/sync", label: "Sync status", icon: "M20 11A8 8 0 0 0 6.3 5.3L4 8m0-4v4h4m-4 5a8 8 0 0 0 13.7 5.7L20 16m0 4v-4h-4" },
];

// Mirrors the rest of Nola's feature set — listed so the roadmap is visible, not clickable yet.
const COMING = ["Sponsored Brands / Display", "Rules (staged)", "Ready-to-deploy queue"];

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme || "");
  const toggle = () => {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("aravi.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  return [theme, toggle];
}

export function App() {
  const route = useRoute();
  const meta = useApi<Meta>("/api/meta");
  const [targetAcos, setTargetAcos] = usePref("targetAcos", 0.3);
  const [, toggleTheme] = useTheme();

  const anchor = meta.data?.maxDate ?? yesterday();
  const from = route.params.get("from");
  const to = route.params.get("to");
  const range: Range = from && to ? { from, to } : presetRange("30d", anchor);

  const setRange = (r: Range) => {
    const p = new URLSearchParams(route.params);
    p.set("from", r.from);
    p.set("to", r.to);
    navigate(route.path, p, true);
  };
  const keepRange = { from: range.from, to: range.to };

  useEffect(() => window.scrollTo(0, 0), [route.path]);

  const section = "/" + (route.path.split("/")[1] ?? "");
  const title =
    route.path.startsWith("/campaigns/") ? "Campaign" : NAV.find((n) => n.path === section)?.label ?? "Not found";

  let page: React.ReactNode = null;
  if (meta.error) page = <ErrorBox message={`${meta.error} — is the API server running?`} />;
  else if (meta.data) {
    const props: PageProps = { range, meta: meta.data, targetAcos, params: route.params };
    if (route.path === "/") page = <OverviewPage {...props} />;
    else if (route.path === "/campaigns") page = <CampaignsPage {...props} />;
    else if (route.path.startsWith("/campaigns/"))
      page = <CampaignDetailPage {...props} id={decodeURIComponent(route.path.slice("/campaigns/".length))} />;
    else if (route.path === "/keywords") page = <KeywordsPage {...props} />;
    else if (route.path === "/search-terms") page = <SearchTermsPage {...props} />;
    else if (route.path === "/insights")
      page = <InsightsPage {...props} onTargetAcos={setTargetAcos} />;
    else if (route.path === "/sync") page = <SyncPage {...props} />;
    else page = <ErrorBox message="This page doesn't exist." />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={href("/", keepRange)}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="var(--brand)" /><path d="M9 22c0-7 5-12 14-13-1 9-6 14-13 14" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>
          </span>
          <span>
            <strong>Aravi Ads</strong>
            <small className="muted">Amazon.in · Sponsored Products</small>
          </span>
        </a>
        <nav className="side-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.path} href={href(n.path, keepRange)} className={`nav-item${section === n.path ? " active" : ""}`}
              aria-current={section === n.path ? "page" : undefined}>
              <Icon d={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="coming">
          <p className="eyebrow">Coming next</p>
          <ul>
            {COMING.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
        <p className="sidebar-foot muted small">Read-only · nothing here changes your Amazon account.</p>
      </aside>

      <div className="main">
        {meta.data?.dataSource === "demo" && (
          <div className="banner demo" role="status">
            <strong>Demo data.</strong> These numbers are generated, not from your Amazon account. Connect the Ads API and run the sync to see real data.
          </div>
        )}
        <header className="topbar">
          <div className="title-block">
            <h1>{title}</h1>
            {meta.data?.maxDate && route.path !== "/sync" && (
              <p className="data-through muted small">Data through {fmtDay(meta.data.maxDate, true)}</p>
            )}
          </div>
          <div className="topbar-actions">
            {meta.data && route.path !== "/sync" && (
              <DateRangePicker range={range} anchor={anchor} minDate={meta.data.minDate} onChange={setRange} />
            )}
            <button className="btn icon" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
              <Icon d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" />
            </button>
          </div>
        </header>
        <main className="content">{page}</main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.path} href={href(n.path, keepRange)} className={section === n.path ? "active" : ""}
            aria-current={section === n.path ? "page" : undefined}>
            <Icon d={n.icon} />
            <span>{n.path === "/search-terms" ? "Terms" : n.label.split(" ")[0]}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
