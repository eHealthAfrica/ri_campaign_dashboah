#!/usr/bin/env python3
"""Build facility catchments and assign each settlement a session type.

    python3 scripts/build_catchment.py [--national path/to/health_facility.sqlite]

Rule: 0-5 km along the road network from the catchment facility = fixed post;
above 5 km = outreach or mobile session.

Distance used for each settlement:
  1. MLoS distance_meters when present. It stops at 5 km.
  2. If blank, road distance to the settlement's own catchment facility on the Lagos road network.
  3. If there is no connected route, or the facility cannot be located, the settlement is "Unreached",
     a session type of its own (decided with the programme team).

Catchment facilities are named in the MLoS but carry no coordinates, so each is located in the
RI facility list by name, confirmed by how well road distances from it reproduce the MLoS.

Writes next to the geopackage (the parent folder of this repo):
    health_facilities_4lga.csv     RI facility list for the four LGAs, without staff contact details
    catchment_facilities_4lga.csv  each catchment facility, where it was located and how
    settlement_catchment_4lga.csv  distance, source, catchment and session type per settlement
    catchment_check.json           evidence shown on the Quality Checks page
"""
import argparse
import difflib
import hashlib
import json
import re
import sqlite3
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

BASE = Path(__file__).resolve().parent.parent.parent
GPKG = BASE / "Lagos_Unicef_ta.gpkg"
ROAD_FILE = BASE / "Lagos Road" / "Lagos State Road.shp"
MATRIX = BASE / ".road_distance_cache.npz"
FIXED_POST_M = 5000
LGA_KEYS = {"alimosho": "Alimosho", "ikorodu": "Ikorodu", "kosofe": "Kosofe", "lagosmainland": "Lagos Mainland"}
# A location is accepted when road distances from it reproduce the MLoS to within this median error.
MATCH_ERROR_M = 300
NAME_MATCH = 0.8
NAME_ONLY_MATCH = 0.85
SPELLING_VARIANT = 0.85
# An exact name is accepted on weaker distance evidence: few settlements to test it, or a small error.
EXACT_NAME = 0.95
EXACT_NAME_ERROR_M = 500
FEW_SETTLEMENTS = 5
GENERIC = (
    r"\b(primary health care centre|primary health care center|primary healthcare centre|primary health centre|"
    r"primary health center|primary health care|primary health|public health center|health care center|"
    r"health centre|health center|phc|p h c|hp|h p|hospital|center|centre)\b"
)

parser = argparse.ArgumentParser()
parser.add_argument("--national", default=str(Path.home() / "Desktop/4_april_26/health_facility.sqlite"))
args = parser.parse_args()


def metres(value):
    return round(float(value)) if np.isfinite(value) else None


def norm(text):
    return re.sub(r"\s+", " ", re.sub(GENERIC, " ", re.sub(r"[^a-z0-9 ]", " ", str(text).lower()))).strip()


def similar(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def load_ri_list():
    sheets = pd.read_excel(BASE / "Lagos HF Comprehensive List.xlsx", sheet_name=None)
    frame = sheets["HF_LIST"]
    frame["lga"] = frame.lganame.astype(str).str.lower().str.replace(r"[^a-z]", "", regex=True).map(LGA_KEYS)
    frame = frame[frame.lga.notna() & frame.latitude.notna()].copy()
    # Field survey rows carry the status for facilities tagged with a survey code.
    survey = sheets["Sheet1"].set_index("unique_code")["16. Enter the functional satus of the Facility"]
    frame["status"] = frame["unique"].map(survey).fillna(frame.functional_status).fillna("Not recorded")
    frame["listed_in"] = "RI facility list"
    # Staff names, gender, phone numbers and emails are deliberately not carried forward.
    keep = ["primary_name", "alternate_name", "lga", "wardname", "latitude", "longitude", "category", "ownership",
            "type", "source", "status", "listed_in"]
    frame = frame[keep].rename(columns={"wardname": "ward"})
    extra_path = Path(args.national)
    if extra_path.exists():
        # Two catchment facilities named in the MLoS are missing from the RI list.
        db = sqlite3.connect(f"file:{extra_path}?mode=ro", uri=True)
        extra = pd.read_sql(
            """select primary_name, alternate_name, ward_lga_lganame as lga, wardname as ward, latitude, longitude,
                      category, ownership, type, source, functional_status as status
               from health_facility where ward_lga_statecode = 'LA'
                 and (primary_name like 'Igbo Olomu%' or primary_name like 'Eruwen%')""",
            db,
        )
        extra["listed_in"] = "National facility database"
        frame = pd.concat([frame, extra], ignore_index=True)
    return frame.reset_index(drop=True)


def load_roads():
    """Road lines as (x, y) vertex arrays. Lines join only where they share an exact vertex."""
    roads = gpd.read_file(ROAD_FILE, columns=["fclass"])
    assert str(roads.crs).endswith("4326"), roads.crs
    return roads


def road_distance_matrix(roads, facilities, settlements):
    """Metres from every facility (rows) to every settlement (columns). Off-road legs are included."""
    stamp = hashlib.sha1(
        f"whole-network|{ROAD_FILE.stat().st_size}".encode()
        + np.round(facilities[["longitude", "latitude"]].to_numpy(), 6).tobytes()
        + np.round(settlements[["longitude", "latitude"]].to_numpy(), 6).tobytes()
    ).hexdigest()
    if MATRIX.exists():
        cached = np.load(MATRIX, allow_pickle=False)
        if str(cached["stamp"]) == stamp:
            return cached["matrix"], json.loads(str(cached["stats"]))
    parts = shapely.get_parts(roads.geometry.values)
    coords = shapely.get_coordinates(parts)
    line_of = np.repeat(np.arange(len(parts)), shapely.get_num_coordinates(parts))
    # Vertices at the same rounded position are one junction.
    unique, node_of = np.unique(np.round(coords, 7), axis=0, return_inverse=True)
    node_of = node_of.ravel()
    to_utm = Transformer.from_crs(4326, 32631, always_xy=True)
    xy = np.column_stack(to_utm.transform(unique[:, 0], unique[:, 1]))
    same_line = line_of[:-1] == line_of[1:]
    pairs = np.column_stack([node_of[:-1][same_line], node_of[1:][same_line]])
    pairs = pairs[pairs[:, 0] != pairs[:, 1]]
    edges = np.unique(np.sort(pairs, axis=1), axis=0)  # a shared segment counts once
    a, b = edges[:, 0], edges[:, 1]
    weight = np.maximum(np.hypot(*(xy[a] - xy[b]).T), 0.01)
    graph = coo_matrix((weight, (a, b)), shape=(len(unique), len(unique))).tocsr()
    # Each point joins its nearest road, even a disconnected one, as the MLoS routing appears to.
    # A pair with no connected route stays infinite: that is a finding, not a distance.
    _, labels = connected_components(graph, directed=False)
    main_label = np.bincount(labels).argmax()
    tree = cKDTree(xy)

    def snap(frame):
        points = np.column_stack(to_utm.transform(frame.longitude.to_numpy(), frame.latitude.to_numpy()))
        gap, position = tree.query(points)
        return position, gap

    s_node, s_gap = snap(settlements)
    f_node, f_gap = snap(facilities)
    unique_nodes, inverse = np.unique(f_node, return_inverse=True)
    from_node = np.zeros((len(unique_nodes), len(s_node)), dtype=np.float32)
    for i, node in enumerate(unique_nodes):
        from_node[i] = dijkstra(graph, directed=False, indices=int(node))[s_node]
    matrix = from_node[inverse] + s_gap.astype(np.float32) + f_gap[:, None].astype(np.float32)
    stats = {
        "roadKm": round(float(weight.sum()) / 1000),
        "medianRoadGapM": round(float(np.median(s_gap)), 1),
        "mainNetworkPct": round(100 * float((labels == main_label).mean()), 1),
        "settlementsOffMain": int((labels[s_node] != main_label).sum()),
    }
    np.savez_compressed(MATRIX, matrix=matrix, stamp=stamp, stats=json.dumps(stats))
    return matrix, stats


facilities = load_ri_list()
print(f"RI facility list: {len(facilities)} facilities in the four LGAs")

master = pd.read_excel(
    BASE / "lagosmlos_Valid.xlsx",
    usecols=["globalid", "latitude", "longitude", "catchment_generated_facility_name", "distance_meters",
             "takeoff_point", "service_type_input", "set_target"],
)
ids = gpd.read_file(GPKG, layer="Settlement", columns=["settlement_id", "globalid"], ignore_geometry=True)
mlos = master.merge(ids, on="globalid", validate="one_to_one")
assert len(mlos) == len(master), "every MLoS row must match a settlement"

matrix, road_stats = road_distance_matrix(load_roads(), facilities, mlos)
print("Road network:", road_stats)

# ---- Locate each catchment facility ------------------------------------------------------------
mlos["raw_name"] = mlos.catchment_generated_facility_name.str.strip()
mlos["key"] = mlos.raw_name.map(norm)
list_names = facilities.primary_name.map(norm).tolist()
list_alts = facilities.alternate_name.map(lambda v: "" if pd.isna(v) else norm(v)).tolist()
distance = mlos.distance_meters.to_numpy()


def locate(key):
    rows = np.flatnonzero(mlos.key.to_numpy() == key)
    known = rows[~np.isnan(distance[rows])]
    scores = np.array([max(similar(key, n), similar(key, a)) for n, a in zip(list_names, list_alts)])
    by_name = int(scores.argmax())
    result = {"key": key, "similarity": round(float(scores[by_name]), 2), "known": len(known)}
    if len(known) == 0:
        accepted = scores[by_name] >= NAME_ONLY_MATCH
        return {**result, "method": "Name only" if accepted else "Not located", "position": by_name if accepted else -1, "error": None}
    errors = np.median(np.abs(matrix[:, known] - distance[known]), axis=1)
    by_distance = int(errors.argmin())
    if scores[by_name] >= NAME_MATCH and errors[by_name] <= MATCH_ERROR_M:
        return {**result, "method": "Name and distance", "position": by_name, "error": metres(errors[by_name])}
    if scores[by_name] >= EXACT_NAME and (len(known) < FEW_SETTLEMENTS or errors[by_name] <= EXACT_NAME_ERROR_M):
        return {**result, "method": "Name only", "position": by_name, "error": metres(errors[by_name])}
    if errors[by_distance] <= MATCH_ERROR_M:
        return {**result, "method": "Distance only", "position": by_distance, "error": metres(errors[by_distance])}
    return {**result, "method": "Not located", "position": -1, "error": metres(errors[by_distance])}


located = pd.DataFrame([locate(key) for key in sorted(mlos.key.unique())]).set_index("key")
sizes = mlos.key.value_counts()

# Spellings of one facility ("Ayetoro" and "Aiyetoro") land on the same point. Merge those.
merge_into = {}
for position, group in located[located.position >= 0].groupby("position"):
    keys = sorted(group.index, key=lambda k: -sizes[k])
    for key in keys[1:]:
        if similar(key, keys[0]) >= SPELLING_VARIANT:
            merge_into[key] = keys[0]
mlos["key"] = mlos.key.replace(merge_into)
located = located.drop(index=list(merge_into))
display_name = mlos.groupby("key").raw_name.agg(lambda s: s.mode().iat[0])
located["name"] = display_name

# ---- Distance and session type -----------------------------------------------------------------
row = np.arange(len(mlos))
position = mlos.key.map(located.position).to_numpy()
assigned = np.full(len(mlos), np.nan)
found = position >= 0
assigned[found] = matrix[position[found], row[found]]
serviceable = (facilities.category != "Laboratory") & (facilities.status != "Not Functional")
service_idx = np.flatnonzero(serviceable)
nearest_at = service_idx[matrix[service_idx].argmin(axis=0)]
nearest = matrix[nearest_at, row].astype(float)
nearest[~np.isfinite(nearest)] = np.nan
routable = np.isfinite(assigned)

blank = np.isnan(distance)
chosen = np.where(~blank, distance, np.where(routable, assigned, np.nan))
source = np.where(~blank, "MLoS", np.where(routable, "Road route to catchment facility", "No road distance"))
reason = np.where(~blank | routable, "", np.where(found, "No connected road route", "Catchment facility not located"))
PLANNED = {"fixed post": "Fixed", "fixed": "Fixed", "outreach": "Outreach", "fixed/outreach": "Fixed/Outreach", "temporary fixed": "Temporary fixed"}
outreach = chosen > FIXED_POST_M
measured = ~np.isnan(chosen)

output = pd.DataFrame({
    "settlement_id": mlos.settlement_id,
    "catchment_key": mlos.key,
    "catchment_facility": mlos.key.map(display_name),
    "mlos_facility_name": mlos.raw_name,
    "distance_km": np.round(chosen / 1000, 3),
    "distance_source": source,
    "unreached_reason": reason,
    "session_type": np.where(~measured, "Unreached", np.where(outreach, "Outreach or mobile", "Fixed post")),
    "road_km_to_catchment_facility": np.round(np.where(routable, assigned, np.nan) / 1000, 3),
    "nearest_facility": np.where(np.isnan(nearest), "", facilities.primary_name.to_numpy()[nearest_at]),
    "nearest_facility_km": np.round(nearest / 1000, 3),
    "planned_session": mlos.service_type_input.str.strip().str.lower().map(PLANNED),
})
output.to_csv(BASE / "settlement_catchment_4lga.csv", index=False)

table = located.reset_index()
table["settlements"] = table.key.map(mlos.key.value_counts())
table["list_facility"] = [facilities.primary_name[p] if p >= 0 else None for p in table.position]
table["latitude"] = [facilities.latitude[p] if p >= 0 else None for p in table.position]
table["longitude"] = [facilities.longitude[p] if p >= 0 else None for p in table.position]
table["listed_in"] = [facilities.listed_in[p] if p >= 0 else None for p in table.position]
table.drop(columns=["position"]).rename(columns={"error": "median_error_m", "known": "settlements_with_mlos_distance"}).to_csv(
    BASE / "catchment_facilities_4lga.csv", index=False)

catchment_points = set(table.position[table.position >= 0])
facilities["is_catchment_facility"] = [i in catchment_points for i in range(len(facilities))]
facilities.to_csv(BASE / "health_facilities_4lga.csv", index=False)

# ---- Evidence --------------------------------------------------------------------------------
method = mlos.key.map(located.method)
confirmed = (~blank) & (method == "Name and distance").to_numpy() & routable
residual = np.abs(assigned[confirmed] - distance[confirmed])
known_located = (~blank) & found
known_routed = known_located & routable
blank_located = blank & found
unreached = ~measured
check = {
    "roadKm": road_stats["roadKm"],
    "mainNetworkPct": road_stats["mainNetworkPct"],
    "settlementsOffMain": road_stats["settlementsOffMain"],
    "facilities": len(facilities),
    "mlosDistances": int((~blank).sum()),
    "blank": int(blank.sum()),
    "blankLocated": int(blank_located.sum()),
    "blankNoRoute": int((blank_located & ~routable).sum()),
    "blankOver5": int((blank & outreach).sum()),
    "blankWithin5": int((blank & measured & ~outreach).sum()),
    "blankNotLocated": int((blank & ~found).sum()),
    "knownLocated": int(known_located.sum()),
    "knownNoRoute": int((known_located & ~routable).sum()),
    "knownAssignedOver5": int((known_routed & (assigned > FIXED_POST_M)).sum()),
    "blankTakeoffDiffers": int((mlos.takeoff_point[blank] != mlos.raw_name[blank]).sum()),
    "outreachWithinOtherFacility": int((outreach & (nearest <= FIXED_POST_M)).sum()),
    "unreachedWithin5OfListed": int((unreached & (nearest <= FIXED_POST_M)).sum()),
    "unreachedUnder5": int(mlos.set_target[unreached].sum()),
    "catchments": len(located),
    "mlosNames": int(mlos.raw_name.str.lower().nunique()),
    "spellingMerged": len(merge_into),
    "methods": {k: int(v) for k, v in located.method.value_counts().items()},
    "settlementsByMethod": {k: int(v) for k, v in method.value_counts().items()},
    "notLocated": sorted(display_name[k] for k in located.index[located.position < 0]),
    "fromNational": sorted(table.name[table.listed_in == "National facility database"]),
    "confirmedSettlements": int(confirmed.sum()),
    "confirmedMedianDiffM": round(float(np.median(residual))),
    "confirmedWithin250Pct": round(float((residual <= 250).mean() * 100), 1),
    "spearman": round(float(pd.Series(assigned[known_routed]).corr(pd.Series(distance[known_routed]), method="spearman")), 2),
}
(BASE / "catchment_check.json").write_text(json.dumps(check, indent=2))
print(json.dumps(check, indent=1))
print(output.session_type.value_counts().to_dict())
print("Under-5s in outreach settlements:", int(mlos.set_target[outreach].sum()))
