#!/usr/bin/env python3
"""Convert the Lagos RI geopackage into the files the dashboard loads.

    python3 scripts/build_data.py [path/to/Lagos_Unicef_ta.gpkg]

Output (gitignored, because it holds settlement-level microplan data):
    data/public/      summary.json, lga.geojson, ward.geojson   open to anyone
    data/restricted/  settlements.json, settlements.geojson,
                      grids/<WARDCODE>.geojson                  needs sign-in

Editor and creator names in the source are deliberately not exported.
"""
import gzip
import json
import re
import shutil
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

ROOT = Path(__file__).resolve().parent.parent
GPKG = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "Lagos_Unicef_ta.gpkg"
OUT = ROOT / "data"
PUBLIC, RESTRICTED = OUT / "public", OUT / "restricted"


def clean(text):
    """Collapse the doubled spaces found in source names ('Iponri  /  Eric Moore')."""
    if text is None or (isinstance(text, float) and np.isnan(text)):
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    path.write_bytes(raw)
    with gzip.open(f"{path}.gz", "wb", compresslevel=9) as f:
        f.write(raw)
    return len(raw)


def to_wgs84(gdf, tolerance_m, precision):
    """Simplify in metres (the source is EPSG:3857), then round to shrink the file."""
    geom = gdf.geometry.simplify(tolerance_m, preserve_topology=True) if tolerance_m else gdf.geometry
    geom = gpd.GeoSeries(geom, crs=gdf.crs).to_crs(4326)
    return shapely.set_precision(geom.values, precision, mode="pointwise")


def bbox(geoms):
    x0, y0, x1, y1 = shapely.total_bounds(geoms)
    return [round(float(v), 5) for v in (x0, y0, x1, y1)]


def feature_collection(geoms, props):
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": p, "geometry": json.loads(shapely.to_geojson(g))}
            for g, p in zip(geoms, props)
        ],
    }


def num(value, digits=2):
    return None if value is None or pd.isna(value) else round(float(value), digits)


def counts(df):
    """Visit and target roll-ups shared by the LGA, ward and state levels."""
    tracked, etally = df.visitation_status == "V", df.etally_visitation == "V"
    outreach = df.session_type == "Outreach or mobile"
    fixed = df.session_type == "Fixed post"
    bands = np.histogram(df.distance_km.dropna(), bins=[0, 1, 2, 3, 4, 5, 1e9])[0]
    median_km = df.distance_km.median()
    return {
        "fixedPost": int(fixed.sum()),
        "unreached": int((df.session_type == "Unreached").sum()),
        "outreach": int(outreach.sum()),
        "outreachVisited": int((outreach & tracked).sum()),
        "unreachedVisited": int(((df.session_type == "Unreached") & df.visit_recorded).sum()),
        "fixedVisited": int((fixed & tracked).sum()),
        "targetOutreach": int(df.loc[outreach, "set_target"].sum()),
        "estimated": int((df.distance_source != "MLoS").sum()),
        "distanceBands": [int(v) for v in bands],
        "medianKm": None if pd.isna(median_km) else round(float(median_km), 2),
        "settlements": int(len(df)),
        "visited": int(tracked.sum()),
        "notVisited": int((~tracked).sum()),
        "etally": int(etally.sum()),
        "both": int((tracked & etally).sum()),
        "trackedOnly": int((tracked & ~etally).sum()),
        "etallyOnly": int((~tracked & etally).sum()),
        "neither": int((~tracked & ~etally).sum()),
        "target": int(df.set_target.sum()),
        "targetVisited": int(df.loc[tracked, "set_target"].sum()),
        "population": int(df.set_popula.sum()),
        "grids": int(df.grids.sum()),
        "buildings": int(df.buildings.sum()),
        "noGrid": int((df.grids == 0).sum()),
    }


print(f"Reading {GPKG}")
lga = gpd.read_file(GPKG, layer="Lagos_Lga")
ward = gpd.read_file(GPKG, layer="Lagos_Ward")
sett = gpd.read_file(GPKG, layer="Settlement")
grid = gpd.read_file(
    GPKG, layer="TA_Grid", columns=["settlement_id", "ward_code", "Building_C", "visitation_status"]
)

# The validated MLoS is the master list, so settlements it dropped leave every total too.
SOURCES = GPKG.parent
mlos_ids = pd.read_excel(SOURCES / "lagosmlos_Valid.xlsx", usecols=["globalid"]).globalid
source_settlements = len(sett)
sett = sett[sett.globalid.isin(mlos_ids)].copy()
source_grid_cells = len(grid)
grid = grid[grid.settlement_id.isin(sett.settlement_id)].reset_index(drop=True)
catchment = pd.read_csv(SOURCES / "settlement_catchment_4lga.csv")
sett = sett.merge(
    catchment[["settlement_id", "catchment_key", "catchment_facility", "distance_km", "distance_source", "unreached_reason", "session_type",
               "planned_session", "nearest_facility", "nearest_facility_km"]],
    on="settlement_id", how="left", validate="one_to_one",
)
assert sett.session_type.notna().all(), "run scripts/build_catchment.py first"
# Programme decision: an unreached settlement counts as not visited, whatever the MLoS recorded.
# The recorded value is kept so the adjustment stays visible and can be compared with published figures.
sett["visit_recorded"] = sett.visitation_status == "V"
sett.loc[sett.session_type == "Unreached", "visitation_status"] = "Unreached"
catchment_check = json.loads((SOURCES / "catchment_check.json").read_text())
facilities = pd.read_csv(SOURCES / "health_facilities_4lga.csv")
catchment_table = pd.read_csv(SOURCES / "catchment_facilities_4lga.csv").set_index("key")
PUBLIC_OWNER = r"Government|Ministry|Primary Health ?care|Federal|Local Government|Prisons"
facilities["is_public"] = facilities.ownership.fillna("").str.contains(PUBLIC_OWNER, case=False, regex=True)

# Grid roll-ups come from the grid layer itself: Settlement.Total_Grid is blank for 707 rows.
per_sett = grid.groupby("settlement_id").agg(grids=("Building_C", "size"), buildings=("Building_C", "sum"))
sett = sett.merge(per_sett, how="left", left_on="settlement_id", right_index=True)
sett[["grids", "buildings"]] = sett[["grids", "buildings"]].fillna(0).astype(int)
sett["lga_code"] = sett.lga_code.astype(str)

# ---- Administrative tables ------------------------------------------------------
active_lga_codes = sorted(sett.lga_code.unique())
active_ward_codes = set(sett.ward_code)
lga["lgacode"] = lga.lgacode.astype(str)
lga_active = lga[lga.lgacode.isin(active_lga_codes)].copy()
ward_active = ward[ward.wardcode.isin(active_ward_codes)].copy()
lga_wgs = to_wgs84(lga, 40, 1e-5)
ward_wgs = to_wgs84(ward_active, 20, 1e-5)
lga_box = {c: bbox(g) for c, g in zip(lga.lgacode, lga_wgs)}
ward_box = {c: bbox(g) for c, g in zip(ward_active.wardcode, ward_wgs)}

lga_rows = []
for _, row in lga_active.sort_values("lganame").iterrows():
    part = sett[sett.lga_code == row.lgacode]
    lga_rows.append({
        "code": row.lgacode,
        "name": clean(row.lganame),
        "wards": int(part.ward_code.nunique()),
        "completenessPublished": num(row.com_percent),
        "visitPublished": num(row.vis_percent),
        "bbox": lga_box[row.lgacode],
        **counts(part),
    })

ward_rows = []
for _, row in ward_active.sort_values(["lganame", "wardname"]).iterrows():
    part = sett[sett.ward_code == row.wardcode]
    ward_rows.append({
        "code": row.wardcode,
        "name": clean(row.wardname),
        "lgaCode": str(row.lgacode),
        "lgaName": clean(row.lganame),
        "visitPublished": num(row.Visit_Percent),
        "bbox": ward_box[row.wardcode],
        **counts(part),
    })

# One row and one dissolved area per facility catchment.
sett_wgs_all = to_wgs84(sett, 3, 1e-5)
catchment_area = {}
facility_rows = []
for key, part in sett.groupby("catchment_key"):
    shape = shapely.union_all(sett_wgs_all[part.index.to_numpy()])
    catchment_area[key] = shapely.set_precision(shapely.simplify(shape, 0.0002), 1e-5)
    located = catchment_table.loc[key]
    facility_rows.append({
        "key": key,
        "name": clean(part.catchment_facility.iat[0]),
        "lgaName": clean(part.lga_name.mode().iat[0]),
        "lgaCodes": sorted(set(part.lga_code)),
        "wardCodes": sorted(set(part.ward_code)),
        "method": located.method,
        "listFacility": None if pd.isna(located.list_facility) else clean(located.list_facility),
        "bbox": bbox(catchment_area[key]),
        **counts(part),
    })

# ---- Quality checks: each one is a claim the Quality Checks page can show evidence for -----
dupes = sett[sett.Uni_code.duplicated(keep=False)].sort_values("Uni_code")
flagged_no_settlements = ward[(ward.Imp_Lga == "YES") & ~ward.wardcode.isin(active_ward_codes)]
grid_visited = int((grid.visitation_status == "V").sum())
planned = sett[sett.planned_session.notna()]
qc = {
    "sourceSettlements": source_settlements,
    "droppedByMlos": source_settlements - len(sett),
    "droppedGridCells": source_grid_cells - len(grid),
    "catchment": catchment_check,
    "plannedSessions": [
        {"planned": name, "fixedPost": int((p.session_type == "Fixed post").sum()),
         "outreach": int((p.session_type == "Outreach or mobile").sum()),
         "unreached": int((p.session_type == "Unreached").sum())}
        for name, p in planned.groupby("planned_session")
    ],
    "plannedBlank": int(sett.planned_session.isna().sum()),
    "facilityOwners": {
        "public": int(facilities.is_public.sum()),
        "total": len(facilities),
    },
    "gridVisited": grid_visited,
    "gridTotal": int(len(grid)),
    "emptyFields": {
        "Visit_Grid": int(sett.Visit_Grid.notna().sum()),
        "comp_percent": int(sett.comp_percent.notna().sum()),
    },
    "duplicateCodes": [
        {"code": clean(r.Uni_code), "id": int(r.settlement_id), "ward": clean(r.ward_name)}
        for r in dupes.itertuples()
    ],
    "visitedNoGrid": int(((sett.visitation_status == "V") & (sett.grids == 0)).sum()),
    "intersectNo": int((sett.intersect_ == "NO").sum()),
    "flaggedWardsNoSettlements": [
        {"code": r.wardcode, "name": clean(r.wardname), "lga": clean(r.lganame)}
        for r in flagged_no_settlements.itertuples()
    ],
    "teamFields": [
        {"lga": clean(r.lganame), "planned": num(r.Total_Enum, 0), "active": num(r.Active_Enum, 0)}
        for r in lga_active.sort_values("lganame").itertuples()
    ],
}

as_of = max(str(v) for v in sett.EditDate.dropna())[:10]
totals = counts(sett)
totals["wards"] = len(ward_rows)
totals["lgas"] = len(lga_rows)
summary = {
    "meta": {
        "state": "Lagos",
        "asOf": as_of,
        "source": GPKG.name,
    },
    "totals": totals,
    "lgas": lga_rows,
    "wards": ward_rows,
    "facilities": facility_rows,
    "qc": qc,
}

# ---- Sanity checks: fail the build instead of shipping numbers that do not add up ----
assert totals["visited"] + totals["notVisited"] == totals["settlements"]
assert not ((sett.session_type == "Unreached") & (sett.visitation_status == "V")).any()
assert totals["visited"] + totals["unreachedVisited"] == int(sett.visit_recorded.sum())
assert totals["both"] + totals["trackedOnly"] + totals["etallyOnly"] + totals["neither"] == totals["settlements"]
assert sum(r["settlements"] for r in lga_rows) == totals["settlements"]
assert sum(r["settlements"] for r in ward_rows) == totals["settlements"]
assert sum(r["visited"] for r in ward_rows) == totals["visited"]
assert totals["fixedPost"] + totals["outreach"] + totals["unreached"] == totals["settlements"]
assert sum(totals["distanceBands"]) == totals["settlements"] - totals["unreached"]
assert sum(r["settlements"] for r in facility_rows) == totals["settlements"]
assert totals["grids"] == len(grid), "every grid cell must roll up to a settlement"
assert sett.settlement_id.is_unique

# ---- Write everything ----------------------------------------------------------
if OUT.exists():
    shutil.rmtree(OUT)

sizes = {}
sizes["summary.json"] = write(PUBLIC / "summary.json", summary)
active = set(active_lga_codes)
sizes["lga.geojson"] = write(PUBLIC / "lga.geojson", feature_collection(
    lga_wgs,
    [{"code": c, "name": clean(n), "active": c in active} for c, n in zip(lga.lgacode, lga.lganame)],
))
sizes["ward.geojson"] = write(PUBLIC / "ward.geojson", feature_collection(
    ward_wgs,
    [{"code": c, "name": clean(n)} for c, n in zip(ward_active.wardcode, ward_active.wardname)],
))

sizes["catchments.geojson"] = write(PUBLIC / "catchments.geojson", feature_collection(
    [catchment_area[r["key"]] for r in facility_rows],
    [
        {"key": r["key"], "coverage": round(100 * r["visited"] / max(r["settlements"], 1), 1)}
        for r in facility_rows
    ],
))
sizes["facilities.geojson"] = write(PUBLIC / "facilities.geojson", {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(r.longitude, 6), round(r.latitude, 6)]},
            "properties": {
                "name": clean(r.primary_name), "category": clean(r.category) or "Not recorded",
                "ownership": clean(r.ownership) or "Not recorded",
                "public": int(r.is_public), "catchment": int(r.is_catchment_facility),
                "ward": clean(r.ward), "lga": clean(r.lga), "status": clean(r.status),
            },
        }
        for r in facilities.itertuples()
    ],
})

sett_wgs = sett_wgs_all
SESSION_CODE = {"Fixed post": 0, "Outreach or mobile": 1, "Unreached": 2}
sizes["settlements.geojson"] = write(RESTRICTED / "settlements.geojson", feature_collection(
    sett_wgs,
    [
        {"id": int(i), "v": int(v == "V"), "o": SESSION_CODE[t]}
        for i, v, t in zip(sett.settlement_id, sett.visitation_status, sett.session_type)
    ],
))
bounds = np.round(shapely.bounds(sett_wgs), 5).tolist()
rows = [
    {
        "id": int(r.settlement_id),
        "name": clean(r.settlement),
        "wardCode": r.ward_code,
        "wardName": clean(r.ward_name),
        "lgaCode": r.lga_code,
        "lgaName": clean(r.lga_name),
        "facility": clean(r.catchment_facility),
        "facilityKey": r.catchment_key,
        "nearestFacility": clean(r.nearest_facility),
        "nearestFacilityKm": None if pd.isna(r.nearest_facility_km) else round(float(r.nearest_facility_km), 2),
        "unreachedReason": clean(r.unreached_reason) or None,
        "visited": r.visitation_status == "V",
        "visitRecorded": bool(r.visit_recorded),
        "etally": r.etally_visitation == "V",
        "target": int(r.set_target),
        "population": int(r.set_popula),
        "grids": int(r.grids),
        "buildings": int(r.buildings),
        "distanceKm": None if pd.isna(r.distance_km) else round(float(r.distance_km), 2),
        "distanceSource": r.distance_source,
        "session": r.session_type,
        "plannedSession": None if pd.isna(r.planned_session) else r.planned_session,
        "bbox": box,
    }
    for r, box in zip(sett.itertuples(), bounds)
]
sizes["settlements.json"] = write(RESTRICTED / "settlements.json", rows)

grid_wgs = to_wgs84(grid, 0, 1e-6)
grid_bytes = 0
codes = grid.ward_code.to_numpy()
for code in sorted(set(codes)):
    mask = codes == code
    grid_bytes += write(RESTRICTED / "grids" / f"{code}.geojson", feature_collection(
        grid_wgs[mask],
        [{"b": int(b)} for b in grid.Building_C[mask]],
    ))
sizes["grids/*.geojson"] = grid_bytes

print(f"Data as of {as_of}: {totals['visited']:,} of {totals['settlements']:,} settlements visited")
for name, size in sizes.items():
    print(f"  {name:24} {size / 1e6:6.2f} MB")
