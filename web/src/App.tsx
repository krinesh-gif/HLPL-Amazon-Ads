import { useCallback, useEffect, useState } from "react";
import { DateRangePicker } from "./components/DateRangePicker";
import { ErrorBox } from "./components/Ui";
import { clearCache, send, UNAUTHORIZED, useApi } from "./lib/api";
import { useQueue } from "./lib/queue";
import { presetRange, yesterday } from "./lib/dates";
import { fmtDay } from "./lib/format";
import { usePref } from "./lib/prefs";
import { href, navigate, useRoute } from "./lib/router";
import { AD_ORDER, AD_SHORT, AD_LABEL } from "./lib/adProducts";
import type { AdProduct, Meta, Range } from "./lib/types";
import { CampaignDetailPage } from "./pages/CampaignDetail";
import { CampaignsPage } from "./pages/Campaigns";
import { InsightsPage } from "./pages/Insights";
import { DataImportPage } from "./pages/DataImport";
import { DeployPage } from "./pages/Deploy";
import { ProductsPage } from "./pages/Products";
import { SbMapperPage } from "./pages/SbMapper";
import { SETUP_LINKS } from "./components/SetupNav";
import { KeywordsPage } from "./pages/Keywords";
import { LoginPage } from "./pages/Login";
import { SearchTermsPage } from "./pages/SearchTerms";
import { OverviewPage } from "./pages/Overview";
import { SyncPage } from "./pages/Sync";

export interface PageProps {
  range: Range;
  meta: Meta;
  targetAcos: number;
  params: URLSearchParams;
  /** Ad-type filter from the header switch; null = all ad types. */
  ad: AdProduct | null;
}

const NAV = [
  { path: "/", label: "Overview", icon: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" },
  { path: "/campaigns", label: "Campaigns", icon: "M4 6h16M4 12h16M4 18h10" },
  { path: "/keywords", label: "Keywords", icon: "M4 7h16M4 12h10M4 17h7M17 14l3 3-3 3" },
  { path: "/search-terms", label: "Search terms", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" },
  { path: "/deploy", label: "Deploy queue", icon: "M12 3v12m0-12 4 4m-4-4-4 4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" },
  { path: "/insights", label: "Insights", icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" },
  { path: "/setup/products", label: "Setup", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" },
];

// Mirrors the rest of Nola's feature set — listed so the roadmap is visible, not clickable yet.
const COMING = ["SB / SD keywords & targets", "Rules (staged)", "Scheduled syncs"];

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

interface Me {
  user: { id: number; username: string } | null;
  hasUsers?: boolean;
  demoLogin?: { username: string; password: string } | null;
}

/** Nothing renders (or is fetched) until there's a session. */
export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const check = useCallback(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((m: Me) => setMe(m))
      .catch(() => setMe({ user: null, hasUsers: true }));
  }, []);
  useEffect(() => {
    check();
    const onUnauthorized = () => { clearCache(); check(); };
    window.addEventListener(UNAUTHORIZED, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED, onUnauthorized);
  }, [check]);

  if (!me) return null;
  if (!me.user) {
    return <LoginPage hasUsers={me.hasUsers ?? true} demoLogin={me.demoLogin ?? null} onSignedIn={() => { clearCache(); check(); }} />;
  }
  const signOut = async () => {
    await send("POST", "/api/auth/logout").catch(() => undefined);
    clearCache();
    setMe({ user: null, hasUsers: true });
  };
  return <Dashboard username={me.user.username} onSignOut={signOut} />;
}

function Dashboard({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  const route = useRoute();
  const meta = useApi<Meta>("/api/meta");
  const [targetAcos, setTargetAcos] = usePref("targetAcos", 0.3);
  const [, toggleTheme] = useTheme();
  const queue = useQueue();

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
  const adParam = route.params.get("ad");
  const ad: AdProduct | null = adParam === "sp" || adParam === "sb" || adParam === "sd" ? adParam : null;
  // Range and ad-type filter carry across the main nav.
  const keepRange: Record<string, string> = { from: range.from, to: range.to, ...(ad ? { ad } : {}) };
  const setAd = (next: AdProduct | null) => {
    const p = new URLSearchParams(route.params);
    p.set("from", range.from);
    p.set("to", range.to);
    if (next) p.set("ad", next);
    else p.delete("ad");
    navigate(route.path, p, true);
  };
  // Only the screens that cover every ad type get the switch.
  const adSwitchPaths = ["/", "/campaigns", "/insights"];
  const products = meta.data ? AD_ORDER.filter((a) => meta.data!.adProducts.includes(a)) : [];
  const showAdSwitch = adSwitchPaths.includes(route.path) && products.length > 1;

  useEffect(() => window.scrollTo(0, 0), [route.path]);

  const isSetup = route.path.startsWith("/setup/") || route.path === "/sync";
  // Setup screens (and Sync status) all light up the one "Setup" entry in the phone tab bar.
  const section = isSetup ? "/setup/products" : "/" + (route.path.split("/")[1] ?? "");
  const title = route.path.startsWith("/campaigns/") ? "Campaign"
    : isSetup ? SETUP_LINKS.find((l) => l.path === route.path)?.label ?? "Setup"
    : NAV.find((n) => n.path === section)?.label ?? "Not found";

  let page: React.ReactNode = null;
  if (meta.error) page = <ErrorBox message={`${meta.error} — is the API server running?`} />;
  else if (meta.data) {
    const props: PageProps = { range, meta: meta.data, targetAcos, params: route.params, ad: adSwitchPaths.includes(route.path) ? ad : null };
    if (route.path === "/") page = <OverviewPage {...props} />;
    else if (route.path === "/campaigns") page = <CampaignsPage {...props} />;
    else if (route.path.startsWith("/campaigns/"))
      page = <CampaignDetailPage {...props} id={decodeURIComponent(route.path.slice("/campaigns/".length))} />;
    else if (route.path === "/keywords") page = <KeywordsPage {...props} />;
    else if (route.path === "/search-terms") page = <SearchTermsPage {...props} />;
    else if (route.path === "/deploy") page = <DeployPage {...props} />;
    else if (route.path === "/setup/products") page = <ProductsPage {...props} />;
    else if (route.path === "/setup/sb-mapper") page = <SbMapperPage {...props} />;
    else if (route.path === "/setup/import") page = <DataImportPage {...props} />;
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
            <small className="muted">Amazon.in · Sponsored ads</small>
          </span>
        </a>
        <nav className="side-nav" aria-label="Main">
          {NAV.filter((n) => n.label !== "Setup").map((n) => (
            <a key={n.path} href={href(n.path, keepRange)} className={`nav-item${section === n.path ? " active" : ""}`}
              aria-current={section === n.path ? "page" : undefined}>
              <Icon d={n.icon} />
              <span>{n.label}</span>
              {n.path === "/deploy" && queue.count > 0 && <span className="badge" aria-label={`${queue.count} staged`}>{queue.count}</span>}
            </a>
          ))}
        </nav>
        <nav className="side-nav setup-group" aria-label="Setup">
          <p className="eyebrow">Setup</p>
          {SETUP_LINKS.map((l) => (
            <a key={l.path} href={href(l.path, keepRange)} className={`nav-item sub${route.path === l.path ? " active" : ""}`}
              aria-current={route.path === l.path ? "page" : undefined}>
              <span>{l.label}</span>
            </a>
          ))}
        </nav>
        <div className="coming">
          <p className="eyebrow">Coming next</p>
          <ul>
            {COMING.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
        <div className="sidebar-foot">
          <p className="muted small">Changes only reach Amazon from the Deploy queue.</p>
          <p className="small user-line">
            Signed in as <strong>{username}</strong> · <button className="linkish" onClick={onSignOut}>Sign out</button>
          </p>
        </div>
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
            {showAdSwitch && (
              <div className="seg ad-switch" role="group" aria-label="Ad type">
                <button className={!ad ? "active" : ""} onClick={() => setAd(null)}>All</button>
                {products.map((p) => (
                  <button key={p} className={ad === p ? "active" : ""} onClick={() => setAd(p)} title={AD_LABEL[p]}>{AD_SHORT[p]}</button>
                ))}
              </div>
            )}
            {meta.data && !["/sync", "/deploy", "/setup/import"].includes(route.path) && (
              <DateRangePicker range={range} anchor={anchor} minDate={meta.data.minDate} onChange={setRange} />
            )}
            <button className="btn show-sm-inline signout-sm" onClick={onSignOut} title={`Signed in as ${username}`}>Sign out</button>
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
            {n.path === "/deploy" && queue.count > 0 && <span className="badge tab-badge">{queue.count}</span>}
            <span>{n.path === "/search-terms" ? "Terms" : n.label.split(" ")[0]}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
