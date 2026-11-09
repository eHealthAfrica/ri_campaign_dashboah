import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, ChevronsLeft, ChevronsRight, Download, FileText, LayoutDashboard, LogIn, LogOut, Map as MapIcon, ShieldCheck,
} from "lucide-react";
import { Login } from "./components/Login";
import { FilterBar } from "./components/FilterBar";
import { Overview } from "./pages/Overview";
import { Geographic } from "./pages/Geographic";
import { Analysis } from "./pages/Analysis";
import { Quality } from "./pages/Quality";
import { Downloads } from "./pages/Downloads";
import { TopControls } from "./components/TopControls";
import { formatDate, getJson, number, percent, resolveScope } from "./lib";
import { usePrefs } from "./prefs";
import type { Filters, Page, Settlement, Summary } from "./types";

const NAV: { id: Page; label: string; icon: typeof MapIcon; intro: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, intro: "Settlement reach and under-5 population for the selected area." },
  { id: "map", label: "Geographic View", icon: MapIcon, intro: "Drill from LGA to ward, or facility catchment, to settlement on the map." },
  { id: "analysis", label: "Analysis", icon: BarChart3, intro: "Where the largest unvisited under-5 populations are, and which settlements fixed posts cannot cover." },
  { id: "quality", label: "Quality Checks", icon: ShieldCheck, intro: "Where the data sources disagree and what to fix before relying on them." },
  { id: "downloads", label: "Data Downloads", icon: Download, intro: "Export the tables behind this dashboard." },
];
const SOURCE_FILE = "lagosmlos_Valid.xlsx";
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
const NO_FILTERS: Filters = { lga: null, facility: null, ward: null, settlement: null };

const pageFromHash = (): Page => {
  const id = window.location.hash.slice(1);
  return NAV.some((n) => n.id === id) ? (id as Page) : "overview";
};

export function App() {
  const { t, dark } = usePrefs();
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [publicView, setPublicView] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    getJson<{ username: string | null }>("/api/me").then((r) => setUser(r.username)).catch(() => setUser(null));
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const entered = Boolean(user) || publicView;

  useEffect(() => {
    if (!entered || summary) return;
    getJson<Summary>("/data/public/summary.json").then(setSummary).catch(() => setFailed(true));
  }, [entered, summary]);

  useEffect(() => {
    if (!user) {
      setSettlements(null);
      return;
    }
    getJson<Settlement[]>("/data/restricted/settlements.json").then(setSettlements).catch(() => setFailed(true));
  }, [user]);

  // Each page opens at its top, not at the scroll position of the last one.
  useEffect(() => {
    document.querySelector(".main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [page]);

  const select = useCallback((next: Partial<Filters>) => setFilters((f) => ({ ...f, ...next })), []);
  const scope = useMemo(
    () => (summary ? resolveScope(summary, filters, settlements) : null),
    [summary, filters, settlements],
  );

  if (user === undefined) return null;
  if (!entered) {
    return (
      <Login
        onSignedIn={(name) => {
          setUser(name);
          setPublicView(false);
        }}
        onPublic={() => setPublicView(true)}
      />
    );
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setPublicView(false);
    setFilters(NO_FILTERS);
    setFailed(false);
  }

  const current = NAV.find((n) => n.id === page)!;
  const signedIn = Boolean(user);
  const context = { summary: summary!, settlements, filters, scope: scope!, select, signedIn };

  const navLink = ({ id, label, icon: Icon }: (typeof NAV)[number], badge?: { value: string; title: string }) => (
    <a key={id} href={`#${id}`} className={page === id ? "active" : ""} aria-current={page === id ? "page" : undefined} title={t(label)}>
      <Icon size={18} aria-hidden />
      <span>{t(label)}</span>
      {badge && <em title={badge.title}>{badge.value}</em>}
    </a>
  );
  const PageIcon = current.icon;

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="mark">RI</span>
          <span className="brand-text">
            <strong>RI Campaign Dashboard</strong>
            <small>eHealth Africa · {summary?.meta.state ?? "Lagos"} State</small>
          </span>
        </div>
        {summary && (
          <div className="run-box">
            <FileText size={18} aria-hidden />
            <span>
              <small>{t("Current snapshot")}</small>
              <b>{SOURCE_FILE} · {percent(summary.totals.visited, summary.totals.settlements)} {t("visited")} · {formatDate(summary.meta.asOf)}</b>
            </span>
          </div>
        )}
        <TopControls />
      </header>

      <aside className="side">
        <div className="side-head">
          <span><LayoutDashboard size={15} aria-hidden /><b>{t("Pages")}</b></span>
          <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={t(collapsed ? "Expand" : "Collapse")} title={t(collapsed ? "Expand" : "Collapse")}>
            {collapsed ? <ChevronsRight size={16} aria-hidden /> : <ChevronsLeft size={16} aria-hidden />}
          </button>
        </div>
        <nav aria-label="Main">
          {NAV.filter((n) => n.id !== "downloads").map((n) => navLink(n, summary ? (
            n.id === "analysis" ? { value: compact(summary.totals.notVisited), title: "Settlements not visited" }
              : n.id === "quality" ? { value: compact(summary.qc.catchment.blank), title: "Settlements with no MLoS distance" }
                : undefined
          ) : undefined))}
        </nav>
        <div className="side-tools">
          <h3>{t("Tools")}</h3>
          <nav aria-label="Tools">{NAV.filter((n) => n.id === "downloads").map((n) => navLink(n))}</nav>
        </div>
        <div className="side-foot">
          {signedIn ? (
            <button onClick={signOut} title={t("Sign out")}>
              <LogOut size={16} aria-hidden /><span>{t("Sign out")} {user}</span>
            </button>
          ) : (
            <button onClick={signOut} title={t("Sign in")}>
              <LogIn size={16} aria-hidden /><span>{t("Sign in for settlement data")}</span>
            </button>
          )}
          <img src={dark ? "/eha-logo-white.png" : "/eha-logo-blue.png"} alt="eHealth Africa" />
        </div>
      </aside>

      <main className="main">
        <div className="content">
          {failed && <div className="notice" role="alert">Some data could not be loaded. Refresh the page or sign in again.</div>}
          {!summary || !scope ? (
            !failed && <p className="loading">Loading data…</p>
          ) : (
            <>
              {page !== "downloads" && page !== "map" && <FilterBar {...context} />}
              <div className={page === "map" ? "visually-hidden" : "title"}>
                <span className="title-icon"><PageIcon size={26} aria-hidden /></span>
                <div>
                  <h1>{t(current.label === "Overview" ? "Campaign Overview" : current.label)}</h1>
                  <p>{t(current.intro)}</p>
                </div>
              </div>
              {page === "map" && <h1 className="geo-crumb"><MapIcon size={16} aria-hidden /><span>{t(current.label)}</span><span aria-hidden>›</span><b>{scope.label}</b></h1>}
              {page === "overview" && (
                <div className="banner ok" role="status">
                  {t("Loaded {file}: {n} settlements, data as of {date}", { file: SOURCE_FILE, n: number(summary.totals.settlements), date: formatDate(summary.meta.asOf) })}
                </div>
              )}
              {!signedIn && (
                <div className="notice">
                  You are viewing the public dashboard, which shows LGA and ward totals only.
                  <button className="link" onClick={signOut}>{t("Sign in")}</button> to see individual settlements.
                </div>
              )}
              {page === "overview" && <Overview {...context} />}
              {page === "map" && <Geographic {...context} />}
              {page === "analysis" && <Analysis {...context} />}
              {page === "quality" && <Quality {...context} />}
              {page === "downloads" && <Downloads {...context} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
