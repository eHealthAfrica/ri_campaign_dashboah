import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CircleCheck, CircleX, Download, Map as MapIcon, MapPinned, Route, Search, Table as TableIcon, Users, UsersRound } from "lucide-react";
import { MapView } from "../components/LazyMap";
import { downloadCsv, inFilters, number, percent, share, TEAM_SIZE, teamsFor } from "../lib";
import { usePrefs } from "../prefs";
import type { Counts, Settlement } from "../types";
import type { PageProps } from "./context";

function Pill({ value }: { value: number }) {
  const tone = value >= 70 ? "good" : value >= 40 ? "mid" : "low";
  return <span className={`pill ${tone}`}>{value.toFixed(1)}%</span>;
}

function Kpi({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return (
    <article className="kpi">
      <div className="kpi-head"><span className="tile-icon">{icon}</span><h3>{label}</h3></div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

interface AreaRow {
  key: string;
  label: string;
  note: string;
  counts?: Counts;
  visited?: boolean;
  onPick: () => void;
}

function AreaList({ title, rows, active, empty }: { title: string; rows: AreaRow[]; active: string | null; empty: string }) {
  const { t } = usePrefs();
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [title]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const isSettlements = rows.some((r) => r.visited !== undefined);
  return (
    <>
      <div className="search area-search">
        <Search size={15} aria-hidden />
        <input aria-label={`Search ${title}`} placeholder={`${t("Search")}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="area-head">
        <span>{title}</span>
        {isSettlements ? <span>{t("Status")}</span> : <span className="area-cols"><span>{t("Visited %")}</span><span>{t("Under-5 %")}</span></span>}
      </div>
      <ul className="area-list">
        {shown.map((r) => (
          <li key={r.key}>
            <button className={active === r.key ? "active" : ""} aria-pressed={active === r.key} onClick={r.onPick}>
              <span className="area-name"><b>{r.label}</b><small>{r.note}</small></span>
              {r.counts && (
                <span className="area-pills">
                  <Pill value={share(r.counts.visited, r.counts.settlements)} />
                  <Pill value={share(r.counts.targetVisited, r.counts.target)} />
                </span>
              )}
              {r.visited !== undefined && <span className={`pill ${r.visited ? "good" : "low"}`}>{t(r.visited ? "Visited" : "Not visited")}</span>}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="empty">{query ? t("No matches") : empty}</li>}
      </ul>
    </>
  );
}

function SettlementTable({ rows }: { rows: Settlement[] }) {
  const shown = rows.slice(0, 500);
  return (
    <>
      <div className="table-bar">
        <span>{number(rows.length)} settlements{rows.length > shown.length ? `, showing the first ${shown.length}` : ""}</span>
        <button
          className="ghost"
          onClick={() => downloadCsv(
            "ri_settlements_selection.csv",
            ["settlement", "ward", "lga", "catchment_facility", "session_type", "road_distance_km", "distance_source", "planned_session", "visited", "etally_reported", "under5_population", "population", "grid_cells", "buildings"],
            rows.map((s) => [s.name, s.wardName, s.lgaName, s.facility, s.session, s.distanceKm, s.distanceSource, s.plannedSession, s.visited, s.etally, s.target, s.population, s.grids, s.buildings]),
          )}
        >
          <Download size={15} aria-hidden />Download table
        </button>
      </div>
      <p className="card-note">* Routed on the road network, because the MLoS has no distance for this settlement.</p>
      <div className="table-wrap tall">
        <table>
          <thead><tr><th>Settlement</th><th>Ward</th><th>LGA</th><th>Status</th><th>eTally</th><th>Session type</th><th className="num">Distance (km)</th><th className="num">Under-5 population</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.wardName}</td><td>{s.lgaName}</td>
                <td>{s.visited ? "Visited" : "Not visited"}</td><td>{s.etally ? "Reported" : "Not reported"}</td>
                <td>{s.session}</td>
                <td className="num">{s.distanceKm === null ? "–" : `${s.distanceKm.toFixed(1)}${s.distanceSource === "MLoS" ? "" : "*"}`}</td>
                <td className="num">{number(s.target)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const byVisited = (a: AreaRow, b: AreaRow) =>
  share(b.counts!.visited, b.counts!.settlements) - share(a.counts!.visited, a.counts!.settlements);

export function Geographic({ summary, settlements, filters, scope, select, signedIn }: PageProps) {
  const { t } = usePrefs();
  const [tab, setTab] = useState<"map" | "table">("map");
  const [group, setGroup] = useState<"admin" | "catchment">(filters.facility ? "catchment" : "admin");
  const c = scope.counts;
  const teams = teamsFor(summary, scope);

  // A click on the map can change the path, so the list follows it.
  useEffect(() => {
    if (filters.facility) setGroup("catchment");
    else if (filters.ward) setGroup("admin");
  }, [filters.facility, filters.ward]);

  const inScope = useMemo(() => (settlements ?? []).filter((s) => inFilters(s, filters)), [settlements, filters]);
  const clear = { lga: null, facility: null, ward: null, settlement: null };
  const area = (count: Counts) => `${number(count.visited)} / ${number(count.settlements)} settlements`;

  let title: string;
  let rows: AreaRow[];
  let active: string | null;
  if (filters.ward || filters.facility) {
    title = t("Settlement");
    active = filters.settlement === null ? null : String(filters.settlement);
    rows = [...inScope].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
      key: String(s.id),
      label: s.name,
      note: `${number(s.target)} under-5s · ${s.session}`,
      visited: s.visited,
      onPick: () => select({
        lga: s.lgaCode,
        ward: filters.facility ? null : s.wardCode,
        settlement: filters.settlement === s.id ? null : s.id,
      }),
    }));
  } else if (group === "catchment") {
    title = t("Facility catchment");
    active = null;
    rows = summary.facilities.map((f) => ({
      key: f.key, label: f.name, note: area(f), counts: f,
      onPick: () => select({ ...clear, facility: f.key }),
    })).sort(byVisited);
  } else if (filters.lga) {
    title = t("Ward");
    active = null;
    rows = summary.wards.filter((w) => w.lgaCode === filters.lga).map((w) => ({
      key: w.code, label: w.name, note: area(w), counts: w,
      onPick: () => select({ lga: w.lgaCode, facility: null, ward: w.code, settlement: null }),
    })).sort(byVisited);
  } else {
    title = t("LGA");
    active = null;
    rows = summary.lgas.map((l) => ({
      key: l.code, label: l.name, note: area(l), counts: l,
      onPick: () => select({ ...clear, lga: l.code }),
    })).sort(byVisited);
  }

  const switchGroup = (next: "admin" | "catchment") => {
    setGroup(next);
    select(clear);
  };

  const crumbs: { label: string; onClick?: () => void }[] = group === "catchment"
    ? [{ label: t("All catchments"), onClick: () => select(clear) }]
    : [{ label: "All 4 LGAs", onClick: () => select(clear) }];
  if (scope.catchment) crumbs.push({ label: scope.catchment.name });
  else if (scope.lga) {
    crumbs.push({ label: scope.lga.name, onClick: () => select({ ...clear, lga: scope.lga!.code }) });
    if (scope.ward) crumbs.push({ label: scope.ward.name });
  }

  const viewToggle = (
    <button
      type="button"
      aria-label={tab === "map" ? "Show settlement table" : "Show map"}
      title={tab === "map" ? "Settlement table" : "Map"}
      onClick={() => setTab(tab === "map" ? "table" : "map")}
    >
      {tab === "map" ? <TableIcon size={16} aria-hidden /> : <MapIcon size={16} aria-hidden />}
    </button>
  );

  return (
    <div className="geo">
      <section className="kpis" aria-label="Key figures">
        <Kpi icon={<MapPinned size={18} aria-hidden />} label={t("Total settlements")} value={number(c.settlements)} note="All settlements in the MLoS for this area." />
        <Kpi icon={<CircleCheck size={18} aria-hidden />} label={t("Settlements visited")} value={number(c.visited)} note={`${percent(c.visited, c.settlements)} of ${number(c.settlements)} planned settlements.`} />
        <Kpi icon={<CircleX size={18} aria-hidden />} label={t("Settlements not visited")} value={number(c.notVisited)} note={`${percent(c.notVisited, c.settlements)} of planned settlements.`} />
        <Kpi icon={<Users size={18} aria-hidden />} label={t("Under-5s in visited")} value={number(c.targetVisited)} note={`${percent(c.targetVisited, c.target)} of ${number(c.target)} under-5s live in visited settlements.`} />
        <Kpi icon={<UsersRound size={18} aria-hidden />} label={t("Facility teams")} value={number(teams.teams)} note={`${number(teams.members)} people, ${TEAM_SIZE} per facility. ${number(teams.withAreas)} teams have areas fixed posts cannot cover.`} />
        <Kpi icon={<Route size={18} aria-hidden />} label={t("Outreach or mobile")} value={number(c.outreach)} note={`Above 5 km by road. A further ${number(c.unreached)} are unreached.`} />
      </section>

      <div className="geo-body card">
        <aside className="area-panel">
          <div className="seg area-group" role="group" aria-label="Browse areas by">
            <button className={group === "admin" ? "on" : ""} aria-pressed={group === "admin"} onClick={() => switchGroup("admin")}>{t("LGA and ward")}</button>
            <button className={group === "catchment" ? "on" : ""} aria-pressed={group === "catchment"} onClick={() => switchGroup("catchment")}>{t("Facility catchment")}</button>
          </div>
          <nav className="area-crumbs" aria-label="Selected area">
            {crumbs.map((crumb, i) => (
              <span key={crumb.label}>
                {i > 0 && <ChevronRight size={14} aria-hidden />}
                {crumb.onClick && i < crumbs.length - 1 ? <button className="link" onClick={crumb.onClick}>{crumb.label}</button> : <b>{crumb.label}</b>}
              </span>
            ))}
          </nav>
          <AreaList title={title} rows={rows} active={active} empty={signedIn ? "No settlements" : t("Sign in to see settlements")} />
        </aside>
        <div className="geo-main">
          {tab === "map" ? (
            <MapView
              summary={summary}
              settlements={settlements}
              filters={filters}
              scope={scope}
              onSelect={select}
              signedIn={signedIn}
              layer={group === "catchment" ? "catchment" : "coverage"}
              extra={signedIn ? <span className="map-tools-inline">{viewToggle}</span> : undefined}
            />
          ) : (
            <div className="geo-table">
              <div className="map-head"><h2><TableIcon size={18} aria-hidden />{scope.label} - settlements</h2><div className="map-tools">{viewToggle}</div></div>
              <SettlementTable rows={inScope} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
