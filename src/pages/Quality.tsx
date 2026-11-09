import { AlertTriangle, CircleCheck, Info } from "lucide-react";
import { number, percent, TEAM_SIZE } from "../lib";
import { usePrefs } from "../prefs";
import type { PageProps } from "./context";

type Level = "review" | "gap" | "ok";

const LEVELS = {
  review: { icon: AlertTriangle, label: "Review" },
  gap: { icon: Info, label: "Data gap" },
  ok: { icon: CircleCheck, label: "Passed" },
};

function Check({ level, title, children }: { level: Level; title: string; children: React.ReactNode }) {
  const { icon: Icon, label } = LEVELS[level];
  return (
    <li className={`check-row ${level}`}>
      <span className="badge"><Icon size={14} aria-hidden />{label}</span>
      <div><strong>{title}</strong><p>{children}</p></div>
    </li>
  );
}

export function Quality({ summary, scope }: PageProps) {
  const { t } = usePrefs();
  const c = scope.counts;
  const { qc, totals } = summary;
  const disagree = c.trackedOnly + c.etallyOnly;
  const pairs = new Set(qc.duplicateCodes.map((d) => d.code)).size;
  const cat = qc.catchment;
  const plannedOutreach = qc.plannedSessions.find((p) => p.planned === "Outreach");
  const team = qc.teamFields.filter((t) => t.planned || t.active);
  const drift = summary.lgas.filter((l) => l.visitPublished !== null && Math.abs(l.visitPublished - (100 * (l.visited + l.unreachedVisited)) / l.settlements) >= 0.01);

  return (
    <>
      <section className="two-col">
        <article className="card">
          <h2>{t("Visit status compared with eTally")}</h2>
          <p className="card-note">{scope.label}. The two sources disagree on {number(disagree)} settlements ({percent(disagree, c.settlements)}).</p>
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr><th /><th className="num">eTally reported</th><th className="num">eTally not reported</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Marked visited</th>
                  <td className="num agree">{number(c.both)}</td>
                  <td className="num differ">{number(c.trackedOnly)}</td>
                </tr>
                <tr>
                  <th scope="row">Marked not visited</th>
                  <td className="num differ">{number(c.etallyOnly)}</td>
                  <td className="num agree">{number(c.neither)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="card-note matrix-note">
            Highlighted cells are disagreements. {number(c.etallyOnly)} settlements have an eTally report
            but no recorded visit, and these are the first to check.
          </p>
        </article>
        <article className="card">
          <h2>{t("Agreement by LGA")}</h2>
          <p className="card-note">Across the implementing LGAs, whichever area is selected.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>LGA</th><th className="num">Visited only</th><th className="num">eTally only</th><th className="num">Agreement</th></tr></thead>
              <tbody>
                {summary.lgas.map((l) => (
                  <tr key={l.code}>
                    <td>{l.name}</td>
                    <td className="num">{number(l.trackedOnly)}</td>
                    <td className="num">{number(l.etallyOnly)}</td>
                    <td className="num">{percent(l.both + l.neither, l.settlements)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="two-col">
        <article className="card">
          <h2>{t("Planned session compared with the 5 km rule")}</h2>
          <p className="card-note">
            Across all settlements. The MLoS records a planned session for {number(totals.settlements - qc.plannedBlank)} of {number(totals.settlements)}.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Planned in MLoS</th><th className="num">Within 5 km</th><th className="num">Above 5 km</th><th className="num">Unreached</th></tr></thead>
              <tbody>
                {qc.plannedSessions.map((p) => (
                  <tr key={p.planned}><td>{p.planned}</td><td className="num">{number(p.fixedPost)}</td><td className="num">{number(p.outreach)}</td><td className="num">{number(p.unreached)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {plannedOutreach && (
            <p className="card-note matrix-note">
              {number(plannedOutreach.fixedPost)} of {number(plannedOutreach.fixedPost + plannedOutreach.outreach + plannedOutreach.unreached)} settlements planned as outreach are within 5 km by road, so the rule and the plan often differ.
            </p>
          )}
        </article>
        <article className="card">
          <h2>{t("How catchment facilities were located")}</h2>
          <p className="card-note">The MLoS names each facility but gives no coordinates, so each was found in the RI facility list.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Evidence</th><th className="num">Catchments</th><th className="num">Settlements</th></tr></thead>
              <tbody>
                {["Name and distance", "Distance only", "Name only", "Not located"].map((m) => (
                  <tr key={m}><td>{m}</td><td className="num">{number(cat.methods[m] ?? 0)}</td><td className="num">{number(cat.settlementsByMethod[m] ?? 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="card-note matrix-note">
            Where name and distance agree, routes on the Lagos road network are a median {number(cat.confirmedMedianDiffM)} m from the MLoS, and {cat.confirmedWithin250Pct}% are within 250 m ({number(cat.confirmedSettlements)} settlements).
            So the MLoS distances are road distances, and they are used as given.
          </p>
        </article>
      </section>

      <section className="card">
        <h2>{t("Source file checks")}</h2>
        <p className="card-note">These apply to the whole file, whichever area is selected.</p>
        <ul className="checks">
          <Check level="review" title={`${number(cat.blank)} settlements have no catchment distance in the MLoS`}>
            A blank appears to mean the MLoS routing found no route within 5 km. Of {number(cat.blankLocated)} whose facility could be located, {number(cat.blankOver5)} route above 5 km and {number(cat.blankNoRoute)} have no connected route; only {number(cat.blankWithin5)} route within 5 km. Among settlements with a distance, only {number(cat.knownNoRoute)} of {number(cat.knownLocated)} have no route.
          </Check>
          <Check level="review" title={`${number(totals.unreached)} settlements are unreached`}>
            They hold {number(cat.unreachedUnder5)} under-5s and are counted as neither fixed post nor outreach. All count as not visited. {number(totals.unreachedVisited)} of them are recorded as visited in the MLoS, so coverage here is {percent(totals.visited, totals.settlements)} against {percent(totals.visited + totals.unreachedVisited, totals.settlements)} from the file as recorded. {number(cat.blankNoRoute)} have no connected road to their facility and {number(cat.blankNotLocated)} have a facility that could not be located.
            {" "}{number(cat.unreachedWithin5OfListed)} are within 5 km by road of some listed facility, so check these for a closer facility or a gap in the road data. The road file has {number(cat.roadKm)} km of road, {cat.mainNetworkPct}% of its junctions are on the main network, and it stops at the state boundary.
          </Check>
          <Check level="review" title={`${number(cat.outreachWithinOtherFacility)} outreach settlements are within 5 km of another listed facility`}>
            They are above 5 km from their catchment facility but closer to a different one, which may be private and may not offer RI sessions. Check these for reassignment before planning outreach.
          </Check>
          <Check level="review" title={`${number(cat.methods["Not located"] ?? 0)} catchment facilities could not be located`}>
            {cat.notLocated.join(", ")}. Their MLoS distances still apply, but they have no map point. {number(cat.blankNotLocated)} settlements with no distance in these catchments are unreached.
          </Check>
          <Check level="review" title={`${number(cat.methods["Distance only"] ?? 0)} catchment facilities were located by distance alone`}>
            Their name is not in the RI list. The listed facility whose road distances best fit the MLoS marks their position, so that point may be a neighbouring facility. A coordinate list for the MLoS facilities would settle this.
          </Check>
          <Check level="review" title={`${number(cat.mlosNames - cat.catchments)} facility name variants were merged`}>
            The MLoS has {number(cat.mlosNames)} facility names, which this dashboard treats as {number(cat.catchments)} catchments. Names were merged where they differ only in wording, such as "Phc", or spelling and point to the same facility.
          </Check>
          <Check level="review" title={`${number(cat.fromNational.length)} catchment facilities are missing from the RI facility list`}>
            {cat.fromNational.join(" and ")}: their positions come from the national facility database instead.
          </Check>
          <Check level="review" title="Grid visit status looks out of date">
            Only {number(qc.gridVisited)} of {number(qc.gridTotal)} grid cells ({percent(qc.gridVisited, qc.gridTotal)}) are
            marked visited, while LGAs publish {Math.min(...summary.lgas.map((l) => l.completenessPublished ?? 0)).toFixed(1)}–{Math.max(...summary.lgas.map((l) => l.completenessPublished ?? 0)).toFixed(1)}% completeness.
            The map therefore shades grid cells by building count, not by visit status.
          </Check>
          <Check level="review" title="Published completeness cannot be recalculated">
            LGA completeness does not match the average of its ward values, weighted or unweighted, so it is shown exactly as published and no statewide figure is derived.
          </Check>
          <Check level="review" title={`${number(totals.noGrid)} settlements have no grid cells`}>
            {number(qc.visitedNoGrid)} of them are marked visited anyway. Without grid cells, their coverage cannot be measured.
          </Check>
          <Check level="review" title={`${pairs} settlement ${pairs === 1 ? "code is" : "codes are"} used twice`}>
            {[...new Set(qc.duplicateCodes.map((d) => d.code))].join(", ")}. Settlement IDs stay unique, so totals are not affected.
          </Check>
          <Check level="review" title={`${number(qc.intersectNo)} settlements are flagged intersect = NO`}>
            The source does not define this flag. They are included in all totals until its meaning is confirmed.
          </Check>
          {qc.flaggedWardsNoSettlements.map((w) => (
            <Check key={w.code} level="review" title={`${w.name} ward is flagged as implementing but has no settlements`}>
              It is in {w.lga}, which has no other implementing wards, so it is left out of this dashboard.
            </Check>
          ))}
          <Check level={drift.length ? "review" : "ok"} title="Published LGA visit % compared with recalculated values">
            {drift.length
              ? drift.map((l) => `${l.name}: ${l.visitPublished?.toFixed(2)}% published, ${((100 * (l.visited + l.unreachedVisited)) / l.settlements).toFixed(2)}% from settlements`).join(". ") + ". This dashboard uses the recalculated values."
              : "All LGA values match."}
          </Check>
          <Check level="gap" title="Settlement-level grid coverage is empty">
            Visit_Grid and comp_percent are blank for all {number(totals.settlements)} settlements, so fully covered and partially covered counts cannot be shown.
          </Check>
          <Check level="gap" title="Team numbers are calculated, not reported">
            Each facility organizes one team of {TEAM_SIZE}, so the {number(summary.facilities.length)} facilities named in the MLoS give {number(summary.facilities.length)} teams and {number(summary.facilities.length * TEAM_SIZE)} members. This counts teams that should exist, not teams confirmed active.
            {" "}{team.length ? `The source file's own team fields are filled only for ${team.map((x) => `${x.lga} (planned ${x.planned ?? "blank"}, active ${x.active ?? "blank"})`).join(" and ")}, and are not used.` : "The source file's own team fields are empty."}
          </Check>
          <Check level="gap" title="The grid validation field cannot show failures">
            Every grid cell is marked Validated, so a valid versus invalid comparison would show nothing.
          </Check>
          <Check level="ok" title={`The validated MLoS removed ${number(qc.droppedByMlos)} duplicate settlements`}>
            The source map layer has {number(qc.sourceSettlements)} settlements and the MLoS has {number(totals.settlements)}. This dashboard follows the MLoS, which also excludes {number(qc.droppedGridCells)} grid cells linked to the removed rows.
          </Check>
          <Check level="ok" title="Roll-ups reconcile">
            LGA and ward totals sum to {number(totals.settlements)} settlements, and all {number(qc.gridTotal)} grid cells link to a settlement. The data build fails if these stop matching.
          </Check>
        </ul>
      </section>
    </>
  );
}
