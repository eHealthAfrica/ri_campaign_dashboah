import { Download, Lock } from "lucide-react";
import { downloadCsv, number, TEAM_SIZE } from "../lib";
import { usePrefs } from "../prefs";
import type { Counts } from "../types";
import type { PageProps } from "./context";

async function downloadFacilities() {
  const res = await fetch("/data/public/facilities.geojson");
  const geo: GeoJSON.FeatureCollection<GeoJSON.Point> = await res.json();
  downloadCsv("ri_health_facilities_4lga.csv",
    ["facility", "category", "ownership", "catchment_facility", "ward", "lga", "status", "longitude", "latitude"],
    geo.features.map(({ properties: p, geometry }) => [
      p!.name, p!.category, p!.ownership, p!.catchment === 1, p!.ward, p!.lga, p!.status,
      geometry.coordinates[0], geometry.coordinates[1],
    ]));
}

export function Downloads({ summary, settlements, signedIn }: PageProps) {
  const { t } = usePrefs();
  const header = ["settlements", "visited", "not_visited", "etally_reported", "under5_population", "under5_in_visited", "population", "fixed_post", "unreached", "outreach_or_mobile", "grid_cells", "buildings"];
  const figures = (r: Counts) => [
    r.settlements, r.visited, r.notVisited, r.etally, r.target, r.targetVisited, r.population, r.fixedPost, r.unreached, r.outreach, r.grids, r.buildings,
  ];
  const stamp = summary.meta.asOf;
  const items = [
    {
      title: "LGA summary",
      note: `${summary.lgas.length} rows, with published completeness.`,
      run: () => downloadCsv(`ri_lga_${stamp}.csv`, ["lga", ...header, "completeness_published"],
        summary.lgas.map((l) => [l.name, ...figures(l), l.completenessPublished])),
    },
    {
      title: "Ward summary",
      note: `${summary.wards.length} rows, with published ward visit %.`,
      run: () => downloadCsv(`ri_ward_${stamp}.csv`, ["ward_code", "ward", "lga", ...header, "visit_percent_published"],
        summary.wards.map((w) => [w.code, w.name, w.lgaName, ...figures(w), w.visitPublished])),
    },
    {
      title: "Facility catchments",
      note: `${summary.facilities.length} catchments, with coverage, session types and how each facility was located.`,
      run: () => downloadCsv(`ri_catchments_${stamp}.csv`, ["catchment_facility", "lga", "located_by", "listed_facility", "median_road_km", "team_members", "areas_for_team", ...header],
        summary.facilities.map((f) => [f.name, f.lgaName, f.method, f.listFacility, f.medianKm, TEAM_SIZE, f.outreach + f.unreached, ...figures(f)])),
    },
    {
      title: "Health facilities",
      note: `${summary.qc.facilityOwners.total} facilities in the four LGAs, ${summary.qc.facilityOwners.public} of them public, with coordinates.`,
      run: downloadFacilities,
    },
  ];
  return (
    <section className="downloads">
      {items.map((i) => (
        <article className="card" key={i.title}>
          <h2>{t(i.title)}</h2>
          <p className="card-note">{i.note}</p>
          <button className="ghost" onClick={i.run}><Download size={15} aria-hidden />Download CSV</button>
        </article>
      ))}
      <article className="card">
        <h2>{t("Settlement list")}</h2>
        <p className="card-note">{number(summary.totals.settlements)} rows, with visit status, session type, road distance and under-5 population.</p>
        {signedIn && settlements ? (
          <button
            className="ghost"
            onClick={() => downloadCsv(`ri_settlements_${stamp}.csv`,
              ["settlement_id", "settlement", "ward_code", "ward", "lga", "catchment_facility", "session_type", "road_distance_km", "distance_source", "planned_session", "nearest_listed_facility", "nearest_listed_facility_km", "visited", "visit_recorded_in_mlos", "etally_reported", "under5_population", "population", "grid_cells", "buildings"],
              settlements.map((s) => [s.id, s.name, s.wardCode, s.wardName, s.lgaName, s.facility, s.session, s.distanceKm, s.distanceSource, s.plannedSession, s.nearestFacility, s.nearestFacilityKm, s.visited, s.visitRecorded, s.etally, s.target, s.population, s.grids, s.buildings]))}
          >
            <Download size={15} aria-hidden />Download CSV
          </button>
        ) : (
          <p className="locked"><Lock size={15} aria-hidden />Sign in to download.</p>
        )}
      </article>
    </section>
  );
}
