import { useState, type ReactNode } from "react";
import { CircleAlert, MapPinned, PieChart, Route, Target, UsersRound } from "lucide-react";
import { Bars, Columns, SessionSplit, VisitSplit, type BarRow } from "../components/Charts";
import { ChartCard } from "../components/ChartCard";
import { MapView } from "../components/LazyMap";
import { inFilters, km, number, percent, share, TEAM_SIZE, teamsFor } from "../lib";
import { usePrefs } from "../prefs";
import type { Counts } from "../types";
import type { PageProps } from "./context";

interface Cell {
  label: string;
  value: string;
  tone?: "good" | "bad";
  title?: string;
}

function KpiCard({ icon, label, value, note, cells, accent }: { icon: ReactNode; label: string; value: string; note: string; cells: Cell[]; accent?: boolean }) {
  return (
    <article className="kpi-card">
      <div className="kpi-card-head"><h3>{label}</h3>{icon}</div>
      <strong className={accent ? "accent" : ""}>{value}</strong>
      <p>{note}</p>
      <dl className="kpi-cells" style={{ gridTemplateColumns: `repeat(${cells.length}, auto)` }}>
        {cells.map((cell) => (
          <div key={cell.label} title={cell.title}>
            <dd className={cell.tone ?? ""}>{cell.value}</dd>
            <dt>{cell.label}</dt>
          </div>
        ))}
      </dl>
    </article>
  );
}

/** Completeness is shown as published: it cannot be recomputed, so no statewide figure is derived. */
function completeness({ summary, scope }: PageProps) {
  if (scope.catchment) {
    return { value: "–", note: "Published for LGAs and wards only, not for catchments." };
  }
  if (scope.ward) {
    const v = scope.ward.visitPublished;
    return { value: v === null ? "–" : `${v.toFixed(1)}%`, note: "Ward Visit_Percent as published in the source file." };
  }
  if (scope.lga) {
    const v = scope.lga.completenessPublished;
    return { value: v === null ? "–" : `${v.toFixed(1)}%`, note: "LGA completeness as published in the source file." };
  }
  const values = summary.lgas.map((l) => l.completenessPublished ?? 0);
  return {
    value: `${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}%`,
    note: "Range across LGAs. The source publishes no statewide figure.",
  };
}

type Metric = "visited" | "under5" | "unvisited";
type Form = "bar" | "column";

const metricRow = (metric: Metric, c: Counts) => {
  if (metric === "under5") return { value: share(c.targetVisited, c.target), max: 100, display: percent(c.targetVisited, c.target) };
  if (metric === "unvisited") return { value: c.notVisited, display: number(c.notVisited) };
  return { value: share(c.visited, c.settlements), max: 100, display: percent(c.visited, c.settlements) };
};

export function Overview(props: PageProps) {
  const { summary, settlements, filters, scope, select } = props;
  const { t } = usePrefs();
  const [metric, setMetric] = useState<Metric>("visited");
  const [distanceForm, setDistanceForm] = useState<Form>("bar");
  const [sessionForm, setSessionForm] = useState<"split" | "bar">("split");
  const c = scope.counts;
  const missed = c.target - c.targetVisited;
  const comp = completeness(props);
  const teams = teamsFor(summary, scope);
  const areaLevel = !filters.facility && !filters.ward;

  let rows: BarRow[];
  let chartTitle: string;
  const sortRows = (a: BarRow, b: BarRow) => (metric === "unvisited" ? b.value - a.value : a.value - b.value);
  if (areaLevel && !filters.lga) {
    chartTitle = t("Settlement coverage by LGA");
    rows = summary.lgas.map((l) => ({
      key: l.code,
      label: l.name,
      ...metricRow(metric, l),
      detail: `${number(l.visited)} of ${number(l.settlements)} settlements visited`,
      onClick: () => select({ lga: l.code, facility: null, ward: null, settlement: null }),
    })).sort(sortRows);
  } else if (areaLevel) {
    chartTitle = t("Settlement coverage by ward");
    rows = summary.wards.filter((w) => w.lgaCode === filters.lga).map((w) => ({
      key: w.code,
      label: w.name,
      ...metricRow(metric, w),
      detail: `${number(w.visited)} of ${number(w.settlements)} settlements visited`,
      onClick: () => select({ ward: w.code, facility: null, settlement: null }),
    })).sort(sortRows);
  } else {
    chartTitle = "Largest unvisited settlements by under-5 population";
    rows = (settlements ?? [])
      .filter((s) => inFilters(s, filters) && !s.visited)
      .sort((a, b) => b.target - a.target)
      .slice(0, 12)
      .map((s) => ({
        key: String(s.id),
        label: s.name,
        value: s.target,
        display: number(s.target),
        onClick: () => select({ settlement: s.id }),
      }));
  }
  const bandRows = ["0–1 km", "1–2 km", "2–3 km", "3–4 km", "4–5 km", "Over 5 km"].map((label, i) => ({
    key: label,
    label,
    value: c.distanceBands[i],
    display: number(c.distanceBands[i]),
    detail: `${percent(c.distanceBands[i], c.settlements - c.unreached)} of settlements with a distance`,
  }));
  const sessionRows: BarRow[] = [
    { key: "fixed", label: t("Fixed post"), value: c.fixedPost, display: number(c.fixedPost), detail: `${percent(c.fixedVisited, c.fixedPost)} visited` },
    { key: "outreach", label: t("Outreach or mobile"), value: c.outreach, display: number(c.outreach), detail: `${percent(c.outreachVisited, c.outreach)} visited` },
    { key: "unmeasured", label: t("Unreached"), value: c.unreached, display: number(c.unreached) },
  ];

  return (
    <>
      {scope.settlement && (
        <section className="card selected-settlement" aria-label="Selected settlement">
          <div>
            <small>Selected settlement</small>
            <h2>{scope.settlement.name}</h2>
            <p>{scope.settlement.wardName} ward, {scope.settlement.lgaName}. Catchment facility: {scope.settlement.facility}</p>
          </div>
          <dl>
            <div><dt>Status</dt><dd>{scope.settlement.visited ? "Visited" : "Not visited"}</dd></div>
            <div><dt>eTally</dt><dd>{scope.settlement.etally ? "Reported" : "Not reported"}</dd></div>
            <div><dt>Under-5 population</dt><dd>{number(scope.settlement.target)}</dd></div>
            <div><dt>Session type</dt><dd>{scope.settlement.session}</dd></div>
            <div>
              <dt>Road distance{scope.settlement.distanceSource === "MLoS" ? "" : " (estimate)"}</dt>
              <dd>{scope.settlement.distanceKm === null ? scope.settlement.unreachedReason : km(scope.settlement.distanceKm)}</dd>
            </div>
            <div><dt>Grid cells</dt><dd>{number(scope.settlement.grids)}</dd></div>
          </dl>
        </section>
      )}
      <section className="kpi-cards" aria-label="Key figures">
        <KpiCard
          icon={<PieChart size={20} aria-hidden />}
          accent
          label={t("Settlement coverage")}
          value={percent(c.visited, c.settlements)}
          note={t("Share of planned settlements visited.")}
          cells={[
            { label: t("Visited"), value: number(c.visited), tone: "good" },
            { label: t("Not visited"), value: number(c.notVisited), tone: "bad" },
          ]}
        />
        <KpiCard
          icon={<MapPinned size={20} aria-hidden />}
          label={t("Total settlements")}
          value={number(c.settlements)}
          note={t("Planned settlements in the MLoS.")}
          cells={[
            { label: t("In eTally"), value: number(c.etally), title: `${percent(c.etally, c.settlements)} of settlements. ${number(c.both)} are also marked visited.` },
            { label: t("Grid cells"), value: number(c.grids), title: `Covering ${number(c.buildings)} counted buildings.` },
            { label: t("Completeness"), value: comp.value, title: comp.note },
          ]}
        />
        <KpiCard
          icon={<Target size={20} aria-hidden />}
          label={t("Under-5 population")}
          value={number(c.target)}
          note={t("From the MLoS. Counts children living there, not children vaccinated.")}
          cells={[
            { label: t("In visited"), value: number(c.targetVisited), tone: "good", title: `${percent(c.targetVisited, c.target)} of target` },
            { label: t("In unvisited"), value: number(missed), tone: "bad", title: `${percent(missed, c.target)} of target` },
          ]}
        />
        <KpiCard
          icon={<Route size={20} aria-hidden />}
          label={t("Session type")}
          value={percent(c.fixedPost, c.settlements)}
          note={t("0–5 km by road is a fixed post. Above 5 km is outreach or mobile.")}
          cells={[
            { label: t("Fixed post"), value: number(c.fixedPost) },
            { label: t("Outreach or mobile"), value: number(c.outreach), tone: "bad", title: `${number(c.targetOutreach)} under-5s, ${percent(c.targetOutreach, c.target)} of target` },
            { label: t("Unreached"), value: number(c.unreached), tone: "bad", title: `No connected road route to the facility, or the facility could not be located. Counted as not visited, including ${number(c.unreachedVisited)} the MLoS records as visited.` },
          ]}
        />
        <KpiCard
          icon={<UsersRound size={20} aria-hidden />}
          label={t("Facility teams")}
          value={number(teams.teams)}
          note={t("One team of {n} per facility, for areas fixed posts cannot cover.", { n: TEAM_SIZE })}
          cells={[
            { label: t("Team members"), value: number(teams.members) },
            { label: t("Teams with areas"), value: number(teams.withAreas), title: "Facilities with at least one outreach, mobile or unreached settlement." },
            { label: t("Areas to cover"), value: number(teams.areas), tone: "bad", title: `${number(c.outreach)} outreach or mobile and ${number(c.unreached)} unreached settlements.` },
          ]}
        />
      </section>
      {(c.notVisited > 0 || c.unreached > 0) && (
        <div className="banner warn" role="status">
          <CircleAlert size={18} aria-hidden />
          <span>{t("{a} settlements are not yet visited, holding {b} under-5s. {c} are unreached, with no road route to their facility. Review Quality Checks before planning sessions.", { a: number(c.notVisited), b: number(missed), c: number(c.unreached) })}</span>
        </div>
      )}
      <section className="two-col" aria-label="Session type">
        <ChartCard
          title={t("Session type by road distance")}
          note={c.estimated > 0 ? `${number(c.estimated)} settlements have no MLoS distance: ${number(c.estimated - c.unreached)} were routed on the road network and ${number(c.unreached)} are unreached. See Quality Checks.` : undefined}
          options={[{ id: "split", label: t("Split") }, { id: "bar", label: t("Bar") }]}
          value={sessionForm}
          onChange={setSessionForm}
        >
          {sessionForm === "split"
            ? <SessionSplit fixedPost={c.fixedPost} outreach={c.outreach} unreached={c.unreached} />
            : <Bars rows={sessionRows} ariaLabel="Settlements by session type" />}
          <dl className="facts">
            <div><dt>{t("Fixed post")}</dt><dd>{number(c.fixedPost)}</dd><small>{percent(c.fixedVisited, c.fixedPost)} {t("visited")}</small></div>
            <div><dt>{t("Outreach or mobile")}</dt><dd>{number(c.outreach)}</dd><small>{c.outreach ? `${percent(c.outreachVisited, c.outreach)} ${t("visited")}` : "–"}</small></div>
            <div><dt>{t("Under-5 population")}</dt><dd>{number(c.targetOutreach)}</dd><small>{t("Outreach or mobile")}</small></div>
          </dl>
        </ChartCard>
        <ChartCard
          title={t("Settlements by road distance to catchment facility")}
          note={<>Median {km(c.medianKm)}.{c.unreached > 0 && ` ${number(c.unreached)} unreached settlements have no road distance and are not shown.`}</>}
          options={[{ id: "bar", label: t("Bar") }, { id: "column", label: t("Column") }]}
          value={distanceForm}
          onChange={setDistanceForm}
        >
          {distanceForm === "bar"
            ? <Bars ariaLabel="Settlements by road distance band" rows={bandRows} />
            : <Columns ariaLabel="Settlements by road distance band" rows={bandRows} />}
        </ChartCard>
      </section>
      <section className="two-col">
        <ChartCard
          title={chartTitle}
          options={areaLevel ? [{ id: "visited", label: t("Visited %") }, { id: "under5", label: t("Under-5 %") }, { id: "unvisited", label: t("Not visited") }] : undefined}
          value={metric}
          onChange={setMetric}
        >
          {rows.length ? (
            <div className="scroll-list"><Bars rows={rows} ariaLabel={chartTitle} /></div>
          ) : (
            <p className="empty">{props.signedIn ? "Every settlement here has been visited." : "Sign in to see settlements in this area."}</p>
          )}
        </ChartCard>
        <ChartCard title={t("Visit status")} note={`${scope.label}.`}>
          <VisitSplit visited={c.visited} notVisited={c.notVisited} />
          <div className="mini-map">
            <MapView summary={summary} settlements={settlements} filters={filters} scope={scope} onSelect={select} signedIn={props.signedIn} />
          </div>
        </ChartCard>
      </section>
    </>
  );
}
