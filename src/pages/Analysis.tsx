import { useMemo } from "react";
import { Bars } from "../components/Charts";
import { inFilters, km, number, percent } from "../lib";
import { usePrefs } from "../prefs";
import type { PageProps } from "./context";

export function Analysis({ summary, settlements, filters, scope, select, signedIn }: PageProps) {
  const { t } = usePrefs();
  const wards = useMemo(
    () => summary.wards
      .filter((w) => !filters.lga || w.lgaCode === filters.lga)
      .filter((w) => !filters.ward || w.code === filters.ward)
      .filter((w) => !scope.catchment || scope.catchment.wardCodes.includes(w.code))
      .map((w) => ({ ...w, missed: w.target - w.targetVisited }))
      .sort((a, b) => b.missed - a.missed)
      .slice(0, 15),
    [summary, filters.lga, filters.ward, scope.catchment],
  );
  const places = useMemo(
    () => (settlements ?? [])
      .filter((s) => !s.visited && inFilters(s, filters))
      .sort((a, b) => b.target - a.target)
      .slice(0, 15),
    [settlements, filters],
  );
  const outreach = useMemo(
    () => (settlements ?? [])
      .filter((s) => s.session !== "Fixed post" && inFilters(s, filters))
      .sort((a, b) => b.target - a.target),
    [settlements, filters],
  );
  const catchments = useMemo(
    () => summary.facilities
      .filter((f) => (!filters.lga || f.lgaCodes.includes(filters.lga)) && (!filters.ward || f.wardCodes.includes(filters.ward)))
      .filter((f) => !filters.facility || f.key === filters.facility)
      .map((f) => ({ ...f, missed: f.target - f.targetVisited }))
      .sort((a, b) => b.missed - a.missed),
    [summary, filters.lga, filters.ward],
  );

  return (
    <>
      <section className="card">
        <h2>{t("LGA comparison")}</h2>
        <p className="card-note">Sorted by under-5 population in unvisited settlements. Select a row to filter.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>LGA</th><th className="num">Settlements</th><th className="num">Visited</th><th className="num">Coverage</th>
                <th className="num">eTally reported</th><th className="num">Published completeness</th>
                <th className="num">Under-5 population</th><th className="num">Under-5s unvisited</th><th className="num">Outreach</th><th className="num">Unreached</th><th className="num">Teams</th>
              </tr>
            </thead>
            <tbody>
              {[...summary.lgas].sort((a, b) => (b.target - b.targetVisited) - (a.target - a.targetVisited)).map((l) => (
                <tr key={l.code} className={filters.lga === l.code ? "row-on" : ""}>
                  <td><button className="link" onClick={() => select({ lga: l.code, facility: null, ward: null, settlement: null })}>{l.name}</button></td>
                  <td className="num">{number(l.settlements)}</td>
                  <td className="num">{number(l.visited)}</td>
                  <td className="num">{percent(l.visited, l.settlements)}</td>
                  <td className="num">{percent(l.etally, l.settlements)}</td>
                  <td className="num">{l.completenessPublished === null ? "–" : `${l.completenessPublished.toFixed(1)}%`}</td>
                  <td className="num">{number(l.target)}</td>
                  <td className="num">{number(l.target - l.targetVisited)}</td>
                  <td className="num">{number(l.outreach)}</td>
                  <td className="num">{number(l.unreached)}</td>
                  <td className="num">{number(summary.facilities.filter((f) => f.lgaCodes.includes(l.code)).length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="two-col">
        <article className="card">
          <h2>{t("Wards with the most under-5s unvisited")}</h2>
          <p className="card-note">{scope.label}. Top {wards.length}.</p>
          <Bars
            ariaLabel="Wards by under-5 population in unvisited settlements"
            rows={wards.map((w) => ({
              key: w.code,
              label: filters.lga ? w.name : `${w.name} (${w.lgaName})`,
              value: w.missed,
              display: number(w.missed),
              detail: `${percent(w.visited, w.settlements)} of settlements visited`,
              onClick: () => select({ lga: w.lgaCode, facility: null, ward: w.code, settlement: null }),
            }))}
          />
        </article>
        <article className="card">
          <h2>{t("Largest unvisited settlements")}</h2>
          <p className="card-note">{scope.label}. Ranked by under-5 population.</p>
          {!signedIn ? (
            <p className="empty">Sign in to see individual settlements.</p>
          ) : places.length === 0 ? (
            <p className="empty">Every settlement here has been visited.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Settlement</th><th>Ward</th><th>Catchment facility</th><th className="num">Under-5s</th><th className="num">Buildings</th></tr></thead>
                <tbody>
                  {places.map((s) => (
                    <tr key={s.id}>
                      <td><button className="link" onClick={() => select({ lga: s.lgaCode, facility: null, ward: s.wardCode, settlement: s.id })}>{s.name}</button></td>
                      <td>{s.wardName}</td><td>{s.facility}</td>
                      <td className="num">{number(s.target)}</td><td className="num">{number(s.buildings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
      <section className="stack">
        <article className="card">
          <h2>{t("Settlements not covered by fixed post")}</h2>
          <p className="card-note">{scope.label}. Work for each facility's team of 3: settlements above 5 km by road, and unreached settlements. Largest under-5 population first.</p>
          {!signedIn ? (
            <p className="empty">Sign in to see individual settlements.</p>
          ) : outreach.length === 0 ? (
            <p className="empty">Fixed posts cover every settlement here.</p>
          ) : (
            <div className="table-wrap tall short">
              <table>
                <thead><tr><th>Settlement</th><th>Catchment facility</th><th>Session type</th><th className="num">Distance (km)</th><th className="num">Under-5s</th><th>Status</th><th>Nearest listed facility</th></tr></thead>
                <tbody>
                  {outreach.map((s) => (
                    <tr key={s.id}>
                      <td><button className="link" onClick={() => select({ lga: s.lgaCode, facility: null, ward: s.wardCode, settlement: s.id })}>{s.name}</button></td>
                      <td>{s.facility}</td>
                      <td>{s.session}</td>
                      <td className="num">{s.distanceKm === null ? "–" : `${s.distanceKm.toFixed(1)}${s.distanceSource === "MLoS" ? "" : "*"}`}</td>
                      <td className="num">{number(s.target)}</td>
                      <td>{s.visited ? "Visited" : "Not visited"}</td>
                      <td>{s.nearestFacility ? `${s.nearestFacility} (${km(s.nearestFacilityKm)})` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {signedIn && outreach.length > 0 && <p className="card-note matrix-note">* Routed on the road network, because the MLoS has no distance for this settlement. The nearest listed facility may be private and may not offer RI sessions.</p>}
        </article>
        <article className="card">
          <h2>{t("Facility catchments")}</h2>
          <p className="card-note">{scope.label}. Sorted by under-5s in unvisited settlements. Select a facility to filter. * All distances routed here.</p>
          <div className="table-wrap tall short">
            <table>
              <thead><tr><th>Facility</th><th>LGA</th><th className="num">Settlements</th><th className="num">Coverage</th><th className="num">Under-5s unvisited</th><th className="num">Median km</th><th className="num">Outreach or mobile</th><th className="num">Unreached</th><th className="num">Areas for team</th></tr></thead>
              <tbody>
                {catchments.map((f) => (
                  <tr key={f.key} className={filters.facility === f.key ? "row-on" : ""}>
                    <td><button className="link" onClick={() => select({ facility: f.key, ward: null, settlement: null })}>{f.name}</button></td><td>{f.lgaName}</td>
                    <td className="num">{number(f.settlements)}</td>
                    <td className="num">{percent(f.visited, f.settlements)}</td>
                    <td className="num">{number(f.missed)}</td>
                    <td className="num">{f.medianKm === null ? "–" : f.medianKm.toFixed(1)}{f.estimated === f.settlements && f.medianKm !== null ? "*" : ""}</td>
                    <td className="num">{number(f.outreach)}</td>
                    <td className="num">{number(f.unreached)}</td>
                    <td className="num">{number(f.outreach + f.unreached)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </>
  );
}
