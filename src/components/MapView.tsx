import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleCheck, Grid3x3, Hospital, Map as MapIcon, MapPin, Route } from "lucide-react";
import { Map as GlMap, NavigationControl, Popup, ScaleControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Filters, Settlement, Summary } from "../types";
import type { Scope } from "../lib";
import { usePrefs } from "../prefs";
import { number, percent, km } from "../lib";

// MapLibre 6 keeps its worker in a separate file, which the bundler cannot find by itself.
setWorkerUrl(workerUrl);

export const COLORS = { fixed: "#0090FC", outreach: "#E2EE64", unreached: "#CCE9FE" };
const BASEMAPS = { light: "https://tiles.openfreemap.org/styles/liberty", dark: "https://tiles.openfreemap.org/styles/dark" };
export const STATUS = { good: "#2E9E5B", mid: "#EE9F27", low: "#CF3A32" };
const NONE = { light: "#E7EAEE", dark: "#5C6B75" };
const LABEL_LAYOUT = { "text-font": ["Noto Sans Regular"], "text-size": 12, "text-padding": 4 };
const LAYER_TITLES = {
  coverage: "Boundary and coverage",
  catchment: "Facility catchments",
  status: "Visit status",
  session: "Session type",
};
const BUILDING_STEPS = ["#CCE9FE", "#99D3FE", "#66BCFD", "#0090FC"];
const EMPTY = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

type Mode = "status" | "session" | "catchment" | "coverage";

interface Props {
  summary: Summary;
  settlements: Settlement[] | null;
  filters: Filters;
  scope: Scope;
  onSelect: (next: Partial<Filters>) => void;
  signedIn: boolean;
  dark: boolean;
  /** Which map layer to open on; changes follow the area list beside the map. */
  layer?: "coverage" | "catchment";
  /** Extra controls for the map header. */
  extra?: ReactNode;
}

const paintVisibility = (map: GlMap, layers: string[], visible: boolean) =>
  layers.forEach((id) => map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"));

export function MapView({ summary, settlements, filters, scope, onSelect, signedIn, layer, extra, dark }: Props) {
  const { t } = usePrefs();
  const INK = dark ? "#FFFFFF" : "#00365F";
  const STRONG = dark ? "#FFFFFF" : "#00223C";
  const noData = dark ? NONE.dark : NONE.light;
  // A coverage of -1 means the area is not part of this campaign.
  const COVERAGE_COLOR = ["step", ["get", "coverage"], noData, 0, STATUS.low, 40, STATUS.mid, 70, STATUS.good] as never;
  const LABEL_PAINT = { "text-color": dark ? "#FFFFFF" : "#00223C", "text-halo-color": dark ? "#0B1A20" : "#FFFFFF", "text-halo-width": 1.6 };
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>(layer ?? "coverage");
  const [zoom, setZoom] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [showFacilities, setShowFacilities] = useState(true);
  const [gridState, setGridState] = useState<"idle" | "loading" | "failed">("idle");
  const [loadFailed, setLoadFailed] = useState(false);

  // Handlers registered once at map creation read the latest values through this ref.
  const latest = useRef({ summary, settlements, onSelect });
  latest.current = { summary, settlements, onSelect };

  useEffect(() => {
    const map = new GlMap({
      container: box.current!,
      style: dark ? BASEMAPS.dark : BASEMAPS.light,
      bounds: boundsOf(summary),
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    map.on("zoom", () => setZoom(map.getZoom()));

    // A plain wheel keeps scrolling the page. Shift and wheel zooms the map.
    map.scrollZoom.disable();
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      const rect = map.getCanvas().getBoundingClientRect();
      const around = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      map.zoomTo(map.getZoom() - (e.deltaY || e.deltaX) * 0.004, { around, duration: 0 });
    };
    box.current!.addEventListener("wheel", onWheel, { passive: false });

    map.on("load", async () => {
      const coverage = new Map(summary.wards.map((w) => [w.code, (100 * w.visited) / Math.max(w.settlements, 1)]));
      const [lga, ward, catchment] = await Promise.all([
        fetch("/data/public/lga.geojson").then((r) => r.json()),
        fetch("/data/public/ward.geojson").then((r) => r.json()),
        fetch("/data/public/catchments.geojson").then((r) => r.json()),
      ]).catch(() => {
        setLoadFailed(true);
        return [EMPTY, EMPTY, EMPTY];
      });
      const wardLga = new Map(summary.wards.map((w) => [w.code, w.lgaCode]));
      ward.features.forEach((f: GeoJSON.Feature) => {
        f.properties!.coverage = coverage.get(f.properties!.code) ?? -1;
        f.properties!.lgaCode = wardLga.get(f.properties!.code) ?? "";
      });
      const lgaRows = new Map(summary.lgas.map((l) => [l.code, l]));
      lga.features.forEach((f: GeoJSON.Feature) => {
        const row = lgaRows.get(f.properties!.code);
        f.properties!.coverage = row ? (100 * row.visited) / Math.max(row.settlements, 1) : -1;
      });
      const catchmentNames = new Map(summary.facilities.map((f) => [f.key, f.name]));
      catchment.features.forEach((f: GeoJSON.Feature) => {
        f.properties!.name = catchmentNames.get(f.properties!.key) ?? "";
      });

      map.addSource("lga", { type: "geojson", data: lga });
      map.addSource("ward", { type: "geojson", data: ward, promoteId: "code" });
      map.addSource("settlement", { type: "geojson", data: EMPTY, promoteId: "id" });
      map.addSource("grid", { type: "geojson", data: EMPTY });
      map.addSource("facility", { type: "geojson", data: "/data/public/facilities.geojson" });
      map.addSource("catchment", { type: "geojson", data: catchment });

      map.addLayer({
        id: "lga-fill",
        type: "fill",
        source: "lga",
        paint: { "fill-color": COVERAGE_COLOR, "fill-opacity": 0.55 },
      });
      map.addLayer({
        id: "ward-fill",
        type: "fill",
        source: "ward",
        filter: ["==", ["get", "lgaCode"], ""],
        paint: { "fill-color": COVERAGE_COLOR, "fill-opacity": 0.6 },
      });
      map.addLayer({
        id: "catchment-fill",
        type: "fill",
        source: "catchment",
        paint: { "fill-color": COVERAGE_COLOR, "fill-opacity": 0.6 },
      });
      map.addLayer({
        id: "settlement-fill",
        type: "fill",
        source: "settlement",
        paint: {
          "fill-color": ["case", ["==", ["get", "v"], 1], STATUS.good, STATUS.low],
          "fill-opacity": 0.82,
        },
      });
      map.addLayer({
        id: "settlement-line",
        type: "line",
        source: "settlement",
        minzoom: 11.5,
        paint: { "line-color": dark ? "#0B1A20" : "#00223C", "line-width": 0.5 },
      });
      map.addLayer({
        id: "grid-fill",
        type: "fill",
        source: "grid",
        paint: {
          "fill-color": [
            "step", ["get", "b"], BUILDING_STEPS[0], 3, BUILDING_STEPS[1], 8, BUILDING_STEPS[2], 15, BUILDING_STEPS[3],
          ],
          "fill-opacity": 0.92,
          "fill-outline-color": "#00223C",
        },
      });
      map.addLayer({ id: "catchment-line", type: "line", source: "catchment", paint: { "line-color": INK, "line-width": 0.9 } });
      map.addLayer({
        id: "ward-line",
        type: "line",
        source: "ward",
        filter: ["==", ["get", "lgaCode"], ""],
        paint: { "line-color": INK, "line-width": 0.9 },
      });
      map.addLayer({
        id: "lga-line",
        type: "line",
        source: "lga",
        paint: {
          "line-color": INK,
          "line-width": ["case", ["get", "active"], 2, 0.9],
        },
      });
      map.addLayer({
        id: "ward-selected",
        type: "line",
        source: "ward",
        filter: ["==", ["get", "code"], ""],
        paint: { "line-color": STRONG, "line-width": 3.5 },
      });
      map.addLayer({
        id: "catchment-selected",
        type: "line",
        source: "catchment",
        filter: ["==", ["get", "key"], ""],
        paint: { "line-color": STRONG, "line-width": 3.5 },
      });
      map.addLayer({
        id: "settlement-selected",
        type: "line",
        source: "settlement",
        filter: ["==", ["get", "id"], -1],
        paint: { "line-color": STRONG, "line-width": 3.5 },
      });

      map.addLayer({
        id: "facility-dot",
        type: "circle",
        source: "facility",
        paint: {
          "circle-radius": ["case", ["==", ["get", "catchment"], 1], 5, 2.5],
          "circle-color": ["case", ["==", ["get", "catchment"], 1], "#FFFFFF", "#99D3FE"],
          "circle-stroke-color": "#00223C",
          "circle-stroke-width": ["case", ["==", ["get", "catchment"], 1], 1.5, 0.5],
        },
      });

      map.addLayer({ id: "lga-label", type: "symbol", source: "lga", layout: { ...LABEL_LAYOUT, "text-field": ["get", "name"] }, paint: LABEL_PAINT } as never);
      map.addLayer({
        id: "ward-label",
        type: "symbol",
        source: "ward",
        filter: ["==", ["get", "lgaCode"], ""],
        layout: { ...LABEL_LAYOUT, "text-size": 11, "text-field": ["get", "name"] },
        paint: LABEL_PAINT,
      } as never);
      map.addLayer({
        id: "catchment-label",
        type: "symbol",
        source: "catchment",
        minzoom: 10.5,
        layout: { ...LABEL_LAYOUT, "text-size": 11, "text-field": ["get", "name"] },
        paint: LABEL_PAINT,
      } as never);

      const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8, maxWidth: "280px" });
      const row = (label: string, value: string) => {
        const line = document.createElement("div");
        line.className = "tip-row";
        const left = document.createElement("span");
        left.textContent = label;
        const right = document.createElement("strong");
        right.textContent = value;
        line.append(left, right);
        return line;
      };
      const tip = (title: string, rows: [string, string][]) => {
        // textContent, not HTML: names come from the source data.
        const el = document.createElement("div");
        const head = document.createElement("div");
        head.className = "tip-title";
        head.textContent = title;
        el.append(head, ...rows.map(([a, b]) => row(a, b)));
        return el;
      };

      map.on("mousemove", "settlement-fill", (e) => {
        if (map.getLayoutProperty("settlement-fill", "visibility") === "none") return;
        const id = e.features?.[0]?.properties?.id;
        const s = latest.current.settlements?.find((x) => x.id === id);
        if (!s) return;
        map.getCanvas().style.cursor = "pointer";
        popup.setLngLat(e.lngLat).setDOMContent(tip(s.name, [
          ["Ward", s.wardName],
          ["Status", s.visited ? "Visited" : "Not visited"],
          ["eTally", s.etally ? "Reported" : "Not reported"],
          ["Under-5 population", number(s.target)],
          ["Session type", s.session],
          ["Road distance", s.distanceKm === null ? (s.unreachedReason ?? "Unreached") : `${km(s.distanceKm)}${s.distanceSource === "MLoS" ? "" : " (routed here)"}`],
          ["Catchment facility", s.facility],
        ])).addTo(map);
      });
      map.on("mouseleave", "settlement-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      // An area's tip and click give way to a settlement drawn on top of it.
      const overSettlement = (point: { x: number; y: number }) =>
        map.getLayoutProperty("settlement-fill", "visibility") !== "none"
        && map.queryRenderedFeatures([point.x, point.y], { layers: ["settlement-fill"] }).length > 0;
      map.on("mousemove", "lga-fill", (e) => {
        if (map.getLayoutProperty("lga-fill", "visibility") === "none" || overSettlement(e.point)) return;
        if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ["ward-fill"] }).length) return;
        const l = latest.current.summary.lgas.find((x) => x.code === e.features?.[0]?.properties?.code);
        if (!l) {
          popup.remove();
          return;
        }
        map.getCanvas().style.cursor = "pointer";
        popup.setLngLat(e.lngLat).setDOMContent(tip(`${l.name} LGA`, [
          ["Settlements visited", `${number(l.visited)} of ${number(l.settlements)}`],
          ["Visited", percent(l.visited, l.settlements)],
          ["Under-5 population", number(l.target)],
          ["Under-5s in visited settlements", percent(l.targetVisited, l.target)],
        ])).addTo(map);
      });
      map.on("mouseleave", "lga-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "lga-fill", (e) => {
        if (map.getLayoutProperty("lga-fill", "visibility") === "none" || overSettlement(e.point)) return;
        if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ["ward-fill"] }).length) return;
        const l = latest.current.summary.lgas.find((x) => x.code === e.features?.[0]?.properties?.code);
        if (l) latest.current.onSelect({ lga: l.code, facility: null, ward: null, settlement: null });
      });
      map.on("mousemove", "catchment-fill", (e) => {
        if (map.getLayoutProperty("catchment-fill", "visibility") === "none" || overSettlement(e.point)) return;
        const key = e.features?.[0]?.properties?.key;
        const f = latest.current.summary.facilities.find((x) => x.key === key);
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        popup.setLngLat(e.lngLat).setDOMContent(tip(`${f.name} catchment`, [
          ["Settlements", number(f.settlements)],
          ["Coverage", percent(f.visited, f.settlements)],
          ["Under-5 population", number(f.target)],
          ["Median road distance", km(f.medianKm)],
          ["Outreach or mobile", number(f.outreach)],
          ["Unreached", number(f.unreached)],
          ["Areas for its team of 3", number(f.outreach + f.unreached)],
        ])).addTo(map);
      });
      map.on("mouseleave", "catchment-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "catchment-fill", (e) => {
        if (map.getLayoutProperty("catchment-fill", "visibility") === "none" || overSettlement(e.point)) return;
        const key = e.features?.[0]?.properties?.key;
        if (key) latest.current.onSelect({ facility: key, ward: null, settlement: null });
      });
      map.on("mousemove", "ward-fill", (e) => {
        if (map.getLayoutProperty("ward-fill", "visibility") === "none" || overSettlement(e.point)) return;
        const code = e.features?.[0]?.properties?.code;
        const w = latest.current.summary.wards.find((x) => x.code === code);
        if (!w) return;
        map.getCanvas().style.cursor = "pointer";
        popup.setLngLat(e.lngLat).setDOMContent(tip(`${w.name} ward`, [
          ["LGA", w.lgaName],
          ["Settlements visited", `${number(w.visited)} of ${number(w.settlements)}`],
          ["Coverage", percent(w.visited, w.settlements)],
        ])).addTo(map);
      });
      map.on("mouseleave", "ward-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      // Registered after the area layers, so a facility's tip wins where they overlap.
      map.on("mousemove", "facility-dot", (e) => {
        const f = e.features?.[0]?.properties;
        if (!f) return;
        map.getCanvas().style.cursor = "default";
        popup.setLngLat(e.lngLat).setDOMContent(tip(f.name, [
          ["Type", f.category],
          ["Ownership", f.ownership],
          ["Role", f.catchment === 1 ? "Catchment facility" : "Other listed facility"],
          ["Ward", `${f.ward}, ${f.lga}`],
          ["Status", f.status],
        ])).addTo(map);
      });
      map.on("mouseleave", "facility-dot", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "settlement-fill", (e) => {
        const id = e.features?.[0]?.properties?.id;
        const s = latest.current.settlements?.find((x) => x.id === id);
        if (s) latest.current.onSelect({ lga: s.lgaCode, facility: null, ward: s.wardCode, settlement: s.id });
      });
      map.on("click", "ward-fill", (e) => {
        if (map.getLayoutProperty("ward-fill", "visibility") === "none" || overSettlement(e.point)) return;
        const code = e.features?.[0]?.properties?.code;
        const w = latest.current.summary.wards.find((x) => x.code === code);
        if (w) latest.current.onSelect({ lga: w.lgaCode, facility: null, ward: w.code, settlement: null });
      });

      setReady(true);
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(box.current!);
    const canvasBox = box.current!;
    return () => {
      canvasBox.removeEventListener("wheel", onWheel);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; later changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Settlement polygons are restricted, so they load only for a signed-in user.
  useEffect(() => {
    if (!ready || !signedIn) return;
    let cancelled = false;
    fetch("/data/restricted/settlements.geojson")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((geo) => {
        if (!cancelled) (mapRef.current?.getSource("settlement") as GeoJSONSource | undefined)?.setData(geo);
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [ready, signedIn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // Once one ward or catchment is chosen, its settlements appear on top.
    const drilled = signedIn && Boolean(filters.ward || filters.facility);
    paintVisibility(map, ["settlement-fill", "settlement-line"], mode === "status" || mode === "session" || drilled);
    paintVisibility(map, ["lga-fill", "ward-fill", "ward-line", "ward-label"], mode === "coverage");
    paintVisibility(map, ["lga-label"], mode !== "catchment");
    paintVisibility(map, ["catchment-fill", "catchment-line", "catchment-label"], mode === "catchment");
    const inLga = ["==", ["get", "lgaCode"], filters.lga ?? ""] as never;
    ["ward-fill", "ward-line", "ward-label"].forEach((id) => map.setFilter(id, inLga));
    map.setPaintProperty(
      "settlement-fill",
      "fill-color",
      mode === "session"
        ? ["match", ["get", "o"], 1, COLORS.outreach, 2, COLORS.unreached, COLORS.fixed]
        : ["case", ["==", ["get", "v"], 1], STATUS.good, STATUS.low],
    );
  }, [ready, mode, signedIn, filters.lga, filters.ward, filters.facility]);

  useEffect(() => {
    if (layer) setMode(layer);
  }, [layer]);

  useEffect(() => {
    if (ready && mapRef.current) paintVisibility(mapRef.current, ["facility-dot"], showFacilities);
  }, [ready, showFacilities]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("ward-selected", ["==", ["get", "code"], filters.ward ?? ""]);
    map.setFilter("catchment-selected", ["==", ["get", "key"], filters.facility ?? ""]);
    map.setFilter("settlement-selected", ["==", ["get", "id"], filters.settlement ?? -1]);
    map.fitBounds(scope.bbox ?? boundsOf(summary), { padding: 48, maxZoom: filters.settlement ? 16 : 15, duration: 500 });
    // Fit only when the selection changes, not when other scope fields recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filters.lga, filters.facility, filters.ward, filters.settlement]);

  // Grid cells load one ward at a time; there are too many to hold at once.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const source = map.getSource("grid") as GeoJSONSource;
    if (!filters.ward || !showGrid || !signedIn) {
      source.setData(EMPTY);
      setGridState("idle");
      return;
    }
    let cancelled = false;
    setGridState("loading");
    fetch(`/data/restricted/grids/${encodeURIComponent(filters.ward)}.geojson`)
      .then((r) => {
        if (r.status === 404) return EMPTY;
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((geo) => {
        if (cancelled) return;
        source.setData(geo);
        setGridState("idle");
      })
      .catch(() => !cancelled && setGridState("failed"));
    return () => {
      cancelled = true;
    };
  }, [ready, filters.ward, showGrid, signedIn]);

  const layerButton = (id: Mode, label: string, icon: ReactNode, restricted = false) => (
    <button
      type="button"
      className={mode === id ? "on" : ""}
      disabled={restricted && !signedIn}
      aria-label={label}
      aria-pressed={mode === id}
      title={restricted && !signedIn ? `${label}: sign in to see settlements` : label}
      onClick={() => setMode(id)}
    >
      {icon}
    </button>
  );
  const gridAvailable = signedIn && Boolean(filters.ward);

  return (
    <div className="map-shell">
      <header className="map-head">
        <h2><MapIcon size={18} aria-hidden />{scope.label} - {t(LAYER_TITLES[mode])}</h2>
        <div className="map-tools" role="group" aria-label="Map layers">
          {layerButton("coverage", t("Boundary and coverage"), <MapIcon size={16} aria-hidden />)}
          {layerButton("catchment", t("Facility catchments"), <Hospital size={16} aria-hidden />)}
          {layerButton("status", t("Visit status"), <CircleCheck size={16} aria-hidden />, true)}
          {layerButton("session", t("Session type"), <Route size={16} aria-hidden />, true)}
          <button
            type="button"
            className={showGrid && gridAvailable ? "on" : ""}
            disabled={!gridAvailable}
            aria-label="Microplan grid by buildings"
            aria-pressed={showGrid && gridAvailable}
            title={gridAvailable ? "Microplan grid by buildings" : "Microplan grid: sign in and pick a ward"}
            onClick={() => setShowGrid((v) => !v)}
          >
            <Grid3x3 size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={showFacilities ? "on" : ""}
            aria-label={t("Health facilities")}
            aria-pressed={showFacilities}
            title={t("Health facilities")}
            onClick={() => setShowFacilities((v) => !v)}
          >
            <MapPin size={16} aria-hidden />
          </button>
          {extra}
          <span className="map-zoom">{zoom !== null && <>Z <b>{zoom.toFixed(1)}</b> · </>}{t("Shift+wheel to zoom")}</span>
        </div>
      </header>
      <div className="map-wrap">
        <div ref={box} className="map" role="application" aria-label="Map of LGAs, wards, catchments and settlements in Lagos" />
        <div className="map-legend">
          {mode === "session" ? (
            <>
              <h3>{t("Session type")}</h3>
              <span><i style={{ background: COLORS.fixed }} />{t("Fixed post")} (0–5 km)</span>
              <span><i style={{ background: COLORS.outreach }} />{t("Outreach or mobile")} (&gt; 5 km)</span>
              <span><i style={{ background: COLORS.unreached }} />{t("Unreached")}</span>
            </>
          ) : mode === "status" ? (
            <>
              <h3>{t("Visit status")}</h3>
              <span><i style={{ background: STATUS.good }} />{t("Visited")}</span>
              <span><i style={{ background: STATUS.low }} />{t("Not visited")}</span>
            </>
          ) : (
            <>
              <h3>{t("Coverage colour")}</h3>
              <span><i style={{ background: STATUS.good }} />{t("Visited")} ≥ 70%</span>
              <span><i style={{ background: STATUS.mid }} />40 – 69%</span>
              <span><i style={{ background: STATUS.low }} />0 – 39%</span>
              {mode === "coverage" && <span><i style={{ background: noData }} />{t("Not in this campaign")}</span>}
              {signedIn && (filters.ward || filters.facility) && <small>Settlements: green visited, red not visited</small>}
            </>
          )}
          {showFacilities && (
            <>
              <span><i className="dot public" />{t("Catchment facility")}</span>
              <span><i className="dot private" />{t("Other listed facility")}</span>
            </>
          )}
          {showGrid && gridAvailable && (
            <div className="ramp">
              <div className="ramp-bar">{BUILDING_STEPS.map((c) => <i key={c} style={{ background: c }} />)}</div>
              <div className="ramp-labels"><span>0</span><span>3</span><span>8</span><span>15+</span></div>
              <small>{gridState === "loading" ? "Loading grid…" : gridState === "failed" ? "Grid failed to load" : "Buildings per grid cell. Not a visit status."}</small>
            </div>
          )}
        </div>
        {loadFailed && <div className="map-error" role="alert">Some map layers failed to load. Refresh to try again.</div>}
      </div>
    </div>
  );
}

function boundsOf(summary: Summary): [number, number, number, number] {
  const boxes = summary.lgas.map((l) => l.bbox);
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}
