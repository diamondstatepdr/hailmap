"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, FilterSpecification } from "maplibre-gl";
import Map, {
  AttributionControl,
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { AreaSelection } from "@/lib/area-selection";
import { normalizeMapBounds, type LngLatBounds } from "@/lib/geo";
import { DEFAULT_HOME_VIEW, chaseMapPadding } from "@/lib/map-home";
import { CANVASS_COLORS } from "@/lib/canvass";
import { MESH_LEGEND } from "@/lib/mesh-legend";
import { toggleMapCredit } from "@/lib/map-credit";
import stateOverlay from "@/data/us-states.json";
import { SIGNIFICANT_COLOR, THREAT_LEGEND, threatFromProperties, type ThreatInfo } from "@/lib/threats";
import "maplibre-gl/dist/maplibre-gl.css";

const states = stateOverlay as FeatureCollection;

const LIGHT_STYLE = "/map/light.json";

function nightStyle(palette: string | undefined): string {
  if (palette === "b") return "/map/night-b.json";
  if (palette === "c") return "/map/night-c.json";
  return "/map/night-a.json";
}

function useMapStyle(theme: "light" | "dark") {
  const [palette, setPalette] = useState<"a" | "b" | "c">("a");
  useEffect(() => {
    const read = () => {
      const value = document.documentElement.dataset.palette;
      setPalette(value === "b" || value === "c" ? value : "a");
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette"] });
    return () => observer.disconnect();
  }, []);
  return theme === "dark" ? nightStyle(palette) : LIGHT_STYLE;
}

const hailSizeColor = [
  "step",
  ["get", "sizeIn"],
  MESH_LEGEND[0].color,
  ...MESH_LEGEND.slice(1).flatMap((band) => [band.minIn, band.color]),
];

const windColor = [
  "interpolate",
  ["linear"],
  ["get", "windMph"],
  40,
  "#93c5fd",
  58,
  "#3b82f6",
  70,
  "#1d4ed8",
  90,
  "#1e3a8a",
];

const pointColor = [
  "case",
  ["==", ["get", "hazard"], "tornado"],
  [
    "match",
    ["get", "efRating"],
    "EF0",
    "#fb7185",
    "EF1",
    "#e11d48",
    "EF2",
    "#be123c",
    "EF3",
    "#9f1239",
    "EF4",
    "#881337",
    "EF5",
    "#4c0519",
    "F0",
    "#fb7185",
    "F1",
    "#e11d48",
    "F2",
    "#be123c",
    "F3",
    "#9f1239",
    "F4",
    "#881337",
    "F5",
    "#4c0519",
    "#e11d48",
  ],
  ["==", ["get", "hazard"], "wind"],
  ["case", ["==", ["typeof", ["get", "windMph"]], "number"], windColor, "#60a5fa"],
  ["==", ["typeof", ["get", "sizeIn"]], "number"],
  hailSizeColor,
  "#64748b",
];

const stateCoreWidth = ["interpolate", ["linear"], ["zoom"], 2, 1.5, 3.6, 2.15, 6, 2.7, 9, 3.5];
const stateCasingWidth = ["interpolate", ["linear"], ["zoom"], 2, 3.6, 3.6, 4.6, 6, 5.4, 9, 6.4];
const stateTextSize = ["interpolate", ["linear"], ["zoom"], 3, 12, 4.5, 15, 6.5, 18, 9, 23];

const swathColor = ["coalesce", ["get", "color"], "#64748b"] as const;

export interface MapFocus {
  lon: number;
  lat: number;
  nonce: number;
  zoom?: number;
}

export interface MapFrame {
  west: number;
  south: number;
  east: number;
  north: number;
  nonce: number;
  maxZoom?: number;
  /** Pixel inset so the framed storm sits in the map that is not covered by the chrome or replay bar. */
  padding?: { top: number; bottom: number; left: number; right: number };
  /**
   * Phone weekly sheet. Padding is computed from the map's own height at fit
   * time. A window-height guess shrinks the country to the whole Americas.
   */
  chaseSheet?: { chromePx: number };
}

const THREAT_LAYERS = new Set([
  "threat-warning-fill",
  "threat-watch-fill",
  "threat-statement-fill",
  "outlook-fill",
  "significant-fill",
]);

const threatEventColor = [
  "match",
  ["get", "event"],
  ...THREAT_LEGEND.flatMap((item) => [item.event, item.fill]),
  "#64748b",
] as never;

interface Props {
  theme: "light" | "dark";
  points: GeoJSON.FeatureCollection;
  swaths: GeoJSON.FeatureCollection;
  mesh?: GeoJSON.FeatureCollection | null;
  meshPulse?: GeoJSON.FeatureCollection | null;
  dealers?: GeoJSON.FeatureCollection | null;
  income: GeoJSON.FeatureCollection | null;
  threats: GeoJSON.FeatureCollection | null;
  showPoints: boolean;
  showSwaths: boolean;
  showMesh?: boolean;
  showIncome: boolean;
  showThreats: boolean;
  showOutlook: boolean;
  showHeat?: boolean;
  heat?: GeoJSON.FeatureCollection | null;
  showHoney?: boolean;
  honey?: GeoJSON.FeatureCollection | null;
  /** When the honey panel is open, keep the storm in the map area beside or above it. */
  honeyPanel?: boolean;
  /** Keep the camera when the map is covered by another tab, then resize on return. */
  visible?: boolean;
  /** Draw the radar swath above warning polygons and with stronger contour fill. */
  emphasizeMesh?: boolean;
  userLocation?: { lat: number; lon: number } | null;
  fieldPins?: GeoJSON.FeatureCollection | null;
  canvassPins?: GeoJSON.FeatureCollection | null;
  selectedId: string | null;
  focus: MapFocus | null;
  frame: MapFrame | null;
  draftPin: { lat: number; lon: number } | null;
  pickMode: boolean;
  blockSelection: boolean;
  onPickLocation: (lon: number, lat: number) => void;
  onSelectReport: (id: string) => void;
  onSelectFieldPin?: (id: string) => void;
  onSelectCanvass?: (id: string) => void;
  onSelectCounty: (info: { fips?: string; income: number | null }) => void;
  onSelectThreat: (info: ThreatInfo) => void;
  onSelectArea?: (area: AreaSelection) => void;
  onSelectDealer?: (id: string) => void;
  onSelectHoney?: (id: string) => void;
  onViewChange?: (bounds: { west: number; south: number; east: number; north: number }) => void;
  onPreviewBounds?: (bounds: { west: number; south: number; east: number; north: number }) => void;
  /** A finger, mouse, or wheel moved the camera. Programmatic fitBounds does not count. */
  onUserMove?: () => void;
  onBackgroundClick?: () => void;
  /** When false, points are already aggregated and MapLibre should not cluster them again. */
  clusterPoints?: boolean;
}

function readMapBounds(map: { getBounds: () => { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number } }): LngLatBounds | null {
  try {
    const box = map.getBounds();
    return normalizeMapBounds({ west: box.getWest(), south: box.getSouth(), east: box.getEast(), north: box.getNorth() });
  } catch {
    return null;
  }
}

function useBrandPaint(theme: "light" | "dark") {
  const fallback = theme === "dark"
    ? { cluster: "#1d4ed8", stroke: "#e0f2fe", halo: "#38bdf8", select: "#7dd3fc" }
    : { cluster: "#1d4ed8", stroke: "#ffffff", halo: "#38bdf8", select: "#0c5f78" };
  const [paint, setPaint] = useState(fallback);
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const pick = (name: string, backup: string) => style.getPropertyValue(name).trim() || backup;
      setPaint({
        cluster: pick("--cluster", fallback.cluster),
        stroke: pick("--cluster-stroke", fallback.stroke),
        halo: pick("--cluster-halo", fallback.halo),
        select: pick("--mark", fallback.select),
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette"] });
    return () => observer.disconnect();
  }, [theme, fallback.cluster, fallback.stroke, fallback.halo, fallback.select]);
  return paint;
}

export default function HailMap({
  theme,
  points,
  swaths,
  mesh = null,
  meshPulse = null,
  dealers = null,
  income,
  threats,
  showPoints,
  showSwaths,
  showMesh = false,
  showIncome,
  showThreats,
  showOutlook,
  showHeat = false,
  heat = null,
  showHoney = false,
  honey = null,
  honeyPanel = false,
  visible = true,
  emphasizeMesh = false,
  userLocation = null,
  fieldPins = null,
  canvassPins = null,
  selectedId,
  focus,
  frame,
  draftPin,
  pickMode,
  blockSelection,
  onPickLocation,
  onSelectReport,
  onSelectFieldPin,
  onSelectCanvass,
  onSelectCounty,
  onSelectThreat,
  onSelectArea,
  onSelectDealer,
  onSelectHoney,
  onViewChange,
  onPreviewBounds,
  onUserMove,
  onBackgroundClick,
  clusterPoints = true,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const flownNonce = useRef<number | null>(null);
  const mapStyle = useMapStyle(theme);
  const brand = useBrandPaint(theme);
  const iconsBound = useRef(false);
  const frameRef = useRef(frame);
  const frameWait = useRef(false);
  frameRef.current = frame;
  const outlookData = useMemo(() => subsetThreats(threats, ["outlook", "significant"]), [threats]);
  const alertData = useMemo(() => subsetThreats(threats, ["watch", "warning", "statement"]), [threats]);
  const interactiveLayerIds = [
    showHoney && honey?.features.length ? "honey-pins" : "",
    showHoney && honey?.features.length ? "honey-heat" : "",
    showPoints ? "hail-clusters" : "",
    showPoints ? "hail-points" : "",
    showPoints ? "hail-point-hit" : "",
    ...(emphasizeMesh
      ? ["mesh-a-fill", "mesh-b-fill", "mesh-pulse-a-fill", "mesh-pulse-b-fill"]
      : [showMesh && mesh?.features.length ? "mesh-fill" : "", showMesh && meshPulse?.features.length ? "mesh-pulse-fill" : ""]),
    showSwaths ? "swath-fill" : "",
    dealers?.features.length ? "dealer-pins" : "",
    dealers?.features.length ? "dealer-hit" : "",
    showThreats ? "threat-warning-fill" : "",
    showThreats ? "threat-watch-fill" : "",
    showThreats ? "threat-statement-fill" : "",
    showOutlook ? "outlook-fill" : "",
    showOutlook ? "significant-fill" : "",
    showIncome ? "income-fill" : "",
    fieldPins?.features.length ? "field-pins" : "",
    fieldPins?.features.length ? "field-pin-hit" : "",
    canvassPins?.features.length ? "canvass-pins" : "",
    canvassPins?.features.length ? "canvass-hit" : "",
  ].filter(Boolean);

  function applyFrame(next: MapFrame | null = frameRef.current) {
    const map = mapRef.current;
    if (!next || !map) return;
    const raw = map.getMap();
    if (!raw.isStyleLoaded()) {
      if (frameWait.current) return;
      frameWait.current = true;
      raw.once("idle", () => {
        frameWait.current = false;
        if (frameRef.current?.nonce === next.nonce) applyFrame(frameRef.current);
      });
      return;
    }
    const width = raw.getContainer().clientWidth;
    const height = raw.getContainer().clientHeight;
    if (width < 280 || height < 320) {
      if (frameWait.current) return;
      frameWait.current = true;
      window.setTimeout(() => {
        frameWait.current = false;
        if (frameRef.current?.nonce === next.nonce) applyFrame(next);
      }, 200);
      return;
    }
    raw.stop();
    const safe = normalizeMapBounds(next);
    if (!safe) return;
    // A search flyTo leaves padding on the camera. fitBounds adds that padding
    // again, which on a phone shrinks the storm to a statewide view.
    if (width < 768) {
      raw.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    }
    const desktop = width >= 768;
    const padding = honeyPanel
      ? desktop
        ? {
            top: Math.min(124, Math.round(height * 0.18)),
            bottom: Math.min(72, Math.round(height * 0.12)),
            left: Math.min(400, Math.round(width * 0.34)),
            right: 48,
          }
        : {
            top: 72,
            bottom: Math.min(Math.round(height * 0.5), height - 220),
            left: 12,
            right: 12,
          }
      : next.chaseSheet && !desktop
        ? chaseMapPadding({
            mobile: true,
            chromePx: next.chaseSheet.chromePx,
            mapHeight: height,
            sheet: true,
          })
        : (next.padding ?? { top: 124, bottom: 232, left: 36, right: 48 });
    try {
      map.fitBounds(
        [
          [safe.west, safe.south],
          [safe.east, safe.north],
        ],
        {
          padding,
          duration: 0,
          maxZoom: next.maxZoom ?? 8.2,
        },
      );
      publishZoom();
    } catch {
      // A latitude outside the world throws inside MapLibre. Keep the camera where it is.
    }
  }

  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    if (!map) return;
    const width = map.getContainer().clientWidth;
    const desktop = width >= 768;
    const padding = honeyPanel
      ? desktop
        ? { top: 120, bottom: 48, left: Math.min(400, Math.round(width * 0.34)), right: 36 }
        : { top: 88, bottom: 280, left: 16, right: 16 }
      : { top: 96, bottom: 260, left: 28, right: 28 };
    if (flownNonce.current === focus.nonce) {
      map.easeTo({ padding, duration: 0 });
      return;
    }
    flownNonce.current = focus.nonce;
    const camera = {
      center: [focus.lon, focus.lat] as [number, number],
      zoom: focus.zoom ?? Math.max(map.getZoom(), 8),
      duration: 700,
      padding,
    };
    map.flyTo(focus.zoom ? camera : { center: camera.center, zoom: camera.zoom, duration: 700 });
  }, [focus, honeyPanel]);

  useEffect(() => {
    if (!visible) return;
    mapRef.current?.getMap()?.resize();
  }, [visible]);

  useEffect(() => {
    applyFrame(frame);
  }, [frame]);

  useEffect(() => {
    const started = performance.now();
    let raf = 0;
    const tick = () => {
      tuckAttribution();
      const root = mapRef.current?.getMap()?.getContainer()?.querySelector(".maplibregl-ctrl-attrib");
      const ready = root?.getAttribute("data-credit") === "open" || root?.getAttribute("data-credit") === "closed";
      if (!ready && performance.now() - started < 4000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapStyle]);

  function installIcons() {
    const map = mapRef.current?.getMap();
    if (!map?.isStyleLoaded()) return;
    try {
      if (!map.hasImage("mark-wind")) map.addImage("mark-wind", windGlyph(), { pixelRatio: 2 });
      if (!map.hasImage("mark-tornado")) map.addImage("mark-tornado", tornadoGlyph(), { pixelRatio: 2 });
    } catch {
      /* Style swaps drop images; the next style event adds them again. */
    }
  }

  function publishZoom() {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const center = map.getCenter();
    const root = map.getContainer();
    root.dataset.mapZoom = map.getZoom().toFixed(2);
    root.dataset.mapLat = center.lat.toFixed(5);
    root.dataset.mapLon = center.lng.toFixed(5);
  }

  function tuckAttribution() {
    const map = mapRef.current?.getMap();
    const root = map?.getContainer()?.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
    if (!root?.classList.contains("maplibregl-compact")) return;
    if (root.dataset.credit === "open" || root.dataset.credit === "closed") return;
    root.dataset.credit = "closed";
    root.classList.remove("maplibregl-compact-show");
    root.removeAttribute("open");
    const summary = root.querySelector("summary");
    summary?.addEventListener(
      "click",
      (event) => {
        const open = toggleMapCredit(root, event);
        summary.setAttribute("aria-expanded", open ? "true" : "false");
      },
      true,
    );
  }

  function quietBaseStateLayers() {
    const map = mapRef.current?.getMap();
    if (!map?.isStyleLoaded()) return;
    for (const id of ["label_state", "place_state", "boundary_state"]) {
      if (!map.getLayer(id)) continue;
      if (map.getLayoutProperty(id, "visibility") !== "none") {
        map.setLayoutProperty(id, "visibility", "none");
      }
    }
    if (map.getLayer("boundary_3")) {
      const filter = map.getFilter("boundary_3");
      const adminChecks = JSON.stringify(filter ?? null).split("admin_level").length - 1;
      if (filter && adminChecks < 3) {
        map.setFilter("boundary_3", ["all", filter, ["!=", ["get", "admin_level"], 4]] as FilterSpecification);
      }
    }
    const layers = map.getStyle().layers ?? [];
    if (map.getLayer("state-names") && layers[layers.length - 1]?.id !== "state-names") {
      map.moveLayer("state-names");
    }
  }

  function onClick(event: MapLayerMouseEvent) {
    if (pickMode) {
      onPickLocation(event.lngLat.lng, event.lngLat.lat);
      return;
    }
    if (blockSelection) return;
    const canvassHit = (event.features ?? []).find(
      (feature) => feature.layer?.id === "canvass-pins" || feature.layer?.id === "canvass-hit",
    );
    if (canvassHit?.properties?.id) {
      onSelectCanvass?.(String(canvassHit.properties.id));
      return;
    }
    const honeyHit = (event.features ?? []).find(
      (feature) => feature.layer?.id === "honey-pins" || feature.layer?.id === "honey-heat",
    );
    if (honeyHit?.properties?.id) {
      onSelectHoney?.(String(honeyHit.properties.id));
      return;
    }
    for (const feature of event.features ?? []) {
      const props = feature.properties ?? {};
      if (feature.layer?.id === "hail-clusters" && props.cluster_id != null) {
        const source = mapRef.current?.getSource("reports");
        const geometry = feature.geometry;
        if (!source || geometry.type !== "Point" || !("getClusterExpansionZoom" in source)) return;
        const [lon, lat] = geometry.coordinates;
        void (source as GeoJSONSource)
          .getClusterExpansionZoom(Number(props.cluster_id))
          .then((zoom) => {
            mapRef.current?.easeTo({ center: [lon, lat], zoom, duration: 600 });
          })
          .catch(() => undefined);
        return;
      }
      if ((feature.layer?.id === "field-pins" || feature.layer?.id === "field-pin-hit") && props.id) {
        onSelectFieldPin?.(String(props.id));
        return;
      }
      if ((feature.layer?.id === "hail-points" || feature.layer?.id === "hail-point-hit") && props.id) {
        onSelectReport(String(props.id));
        return;
      }
      if ((feature.layer?.id === "dealer-pins" || feature.layer?.id === "dealer-hit") && props.id) {
        onSelectDealer?.(String(props.id));
        return;
      }
      if ((isRadarLayer(feature.layer?.id) || feature.layer?.id === "swath-fill") && feature.geometry) {
        const geometry = feature.geometry;
        if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return;
        const minIn = numberProp(props.minIn);
        const maxIn = numberProp(props.maxIn ?? props.maxSizeIn);
        const radar = isRadarLayer(feature.layer.id);
        onSelectArea?.({
          id: String(props.id ?? feature.id ?? `${feature.layer.id}-${minIn}`),
          label: radar
            ? `Radar hail ${props.label ?? ""}`.trim()
            : maxIn != null
              ? `Report swath · ${maxIn.toFixed(2)} in`
              : "Report swath",
          source: radar ? "mesh" : "reports",
          minIn,
          maxIn,
          geometry,
        });
        return;
      }
      if (feature.layer?.id && THREAT_LAYERS.has(feature.layer.id)) {
        const threat = threatFromProperties(props as Record<string, unknown>);
        if (threat) onSelectThreat(threat);
        return;
      }
      if (feature.layer?.id === "income-fill") {
        const incomeValue = props.income == null || props.income === "null" ? null : Number(props.income);
        onSelectCounty({
          fips: props.fips ? String(props.fips) : undefined,
          income: incomeValue != null && Number.isFinite(incomeValue) ? incomeValue : null,
        });
        return;
      }
    }
    onBackgroundClick?.();
  }

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: focus?.lon ?? DEFAULT_HOME_VIEW.lon,
        latitude: focus?.lat ?? DEFAULT_HOME_VIEW.lat,
        zoom: focus?.zoom ?? DEFAULT_HOME_VIEW.zoom,
      }}
      mapStyle={mapStyle}
      attributionControl={false}
      onLoad={() => {
        const map = mapRef.current?.getMap();
        if (map && !iconsBound.current) {
          iconsBound.current = true;
          map.on("styleimagemissing", (event) => {
            const id = event.id;
            if (id !== "mark-wind" && id !== "mark-tornado") return;
            if (map.hasImage(id)) return;
            map.addImage(id, id === "mark-wind" ? windGlyph() : tornadoGlyph(), { pixelRatio: 2 });
          });
        }
        installIcons();
        quietBaseStateLayers();
        tuckAttribution();
        publishZoom();
        applyFrame();
        const raw = mapRef.current?.getMap();
        const bounds = raw ? readMapBounds(raw) : null;
        if (bounds) onViewChange?.(bounds);
      }}
      onStyleData={() => {
        installIcons();
        quietBaseStateLayers();
      }}
      interactiveLayerIds={interactiveLayerIds}
      onClick={onClick}
      onMove={(event) => {
        const bounds = readMapBounds(event.target);
        if (bounds) onPreviewBounds?.(bounds);
        if (event.originalEvent) onUserMove?.();
      }}
      onMoveEnd={(event) => {
        const bounds = readMapBounds(event.target);
        publishZoom();
        if (!bounds) return;
        onPreviewBounds?.(bounds);
        if (event.originalEvent) onUserMove?.();
        onViewChange?.(bounds);
      }}
      onMouseMove={(event) => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = pickMode ? "crosshair" : event.features?.length ? "pointer" : "";
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="top-right" showCompass={false} />
      <AttributionControl compact position="bottom-right" />
      {showIncome && income ? (
        <Source id="income" type="geojson" data={income}>
          <Layer
            id="income-fill"
            type="fill"
            paint={{
              "fill-color": [
                "match",
                ["get", "quintile"],
                1,
                "#dbeafe",
                2,
                "#93c5fd",
                3,
                "#60a5fa",
                4,
                "#2563eb",
                5,
                "#1e3a8a",
                "rgba(0,0,0,0)",
              ],
              "fill-opacity": theme === "dark" ? 0.45 : 0.62,
            }}
          />
        </Source>
      ) : null}
      {showOutlook && outlookData.features.length ? (
        <Source id="outlook" type="geojson" data={outlookData}>
          <Layer
            id="outlook-fill"
            type="fill"
            filter={["==", ["get", "kind"], "outlook"]}
            paint={{
              "fill-color": ["get", "fill"] as never,
              "fill-opacity": theme === "dark" ? 0.42 : 0.34,
            }}
          />
          <Layer
            id="outlook-casing"
            type="line"
            filter={["==", ["get", "kind"], "outlook"]}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{
              "line-color": theme === "dark" ? "#f8fafc" : "#ffffff",
              "line-width": 3.4,
              "line-opacity": theme === "dark" ? 0.45 : 0.9,
            }}
          />
          <Layer
            id="outlook-line"
            type="line"
            filter={["==", ["get", "kind"], "outlook"]}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{
              "line-color": ["get", "stroke"] as never,
              "line-width": 1.8,
              "line-opacity": 0.95,
            }}
          />
          <Layer
            id="significant-fill"
            type="fill"
            filter={["==", ["get", "kind"], "significant"]}
            paint={{
              "fill-color": SIGNIFICANT_COLOR,
              "fill-opacity": theme === "dark" ? 0.18 : 0.12,
            }}
          />
          <Layer
            id="significant-line"
            type="line"
            filter={["==", ["get", "kind"], "significant"]}
            layout={{ "line-join": "round", "line-cap": "butt" }}
            paint={{
              "line-color": theme === "dark" ? "#ddd6fe" : SIGNIFICANT_COLOR,
              "line-width": 2.2,
              "line-opacity": 0.95,
              "line-dasharray": [2, 1.4],
            }}
          />
        </Source>
      ) : null}
      {showHeat && heat?.features.length ? (
        <Source id="damage-heat" type="geojson" data={heat}>
          <Layer
            id="damage-heat-fill"
            type="fill"
            paint={{
              "fill-color": ["get", "fill"] as never,
              "fill-opacity": theme === "dark" ? 0.38 : 0.45,
            }}
          />
        </Source>
      ) : null}
      {showSwaths ? (
        <SwathSource
          id="swath"
          data={swaths}
          fill={theme === "dark" ? 0.48 : 0.52}
          lineWidth={1.75}
          lineOpacity={1}
          blur={0}
          theme={theme}
          labels
        />
      ) : null}
      {showMesh && !emphasizeMesh ? <MeshContours mesh={mesh} meshPulse={meshPulse} theme={theme} emphasis={false} faded={showHoney} /> : null}
      {showThreats && alertData.features.length ? (
        <Source id="alerts" type="geojson" data={alertData}>
          <Layer
            id="threat-watch-fill"
            type="fill"
            filter={["==", ["get", "kind"], "watch"]}
            paint={{
              "fill-color": threatEventColor,
              "fill-opacity": theme === "dark" ? 0.16 : 0.12,
            }}
          />
          <Layer
            id="threat-watch-line"
            type="line"
            filter={["==", ["get", "kind"], "watch"]}
            layout={{ "line-join": "round", "line-cap": "butt" }}
            paint={{
              "line-color": threatEventColor,
              "line-width": 2.4,
              "line-opacity": 0.95,
              "line-dasharray": [3, 1.6],
            }}
          />
          <Layer
            id="threat-statement-fill"
            type="fill"
            filter={["==", ["get", "kind"], "statement"]}
            paint={{
              "fill-color": threatEventColor,
              "fill-opacity": theme === "dark" ? 0.16 : 0.1,
            }}
          />
          <Layer
            id="threat-statement-line"
            type="line"
            filter={["==", ["get", "kind"], "statement"]}
            layout={{ "line-join": "round", "line-cap": "butt" }}
            paint={{
              "line-color": threatEventColor,
              "line-width": 2,
              "line-opacity": 0.95,
              "line-dasharray": [1.2, 1.2],
            }}
          />
          <Layer
            id="threat-warning-casing"
            type="line"
            filter={["==", ["get", "kind"], "warning"]}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{
              "line-color": theme === "dark" ? "#0b1220" : "#ffffff",
              "line-width": 4.2,
              "line-opacity": 0.9,
            }}
          />
          <Layer
            id="threat-warning-fill"
            type="fill"
            filter={["==", ["get", "kind"], "warning"]}
            paint={{
              "fill-color": threatEventColor,
              "fill-opacity": theme === "dark" ? 0.28 : 0.22,
            }}
          />
          <Layer
            id="threat-warning-line"
            type="line"
            filter={["==", ["get", "kind"], "warning"]}
            layout={{ "line-join": "round", "line-cap": "round" }}
            paint={{
              "line-color": threatEventColor,
              "line-width": 2.4,
              "line-opacity": 1,
            }}
          />
        </Source>
      ) : null}
      <Source id="us-states" type="geojson" data={states}>
        <Layer
          id="state-border-casing"
          type="line"
          filter={["==", ["get", "kind"], "boundary"]}
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{
            "line-color": theme === "dark" ? "#0b1220" : "#ffffff",
            "line-width": stateCasingWidth as never,
            "line-opacity": 0.95,
          }}
        />
        <Layer
          id="state-border"
          type="line"
          filter={["==", ["get", "kind"], "boundary"]}
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{
            "line-color": theme === "dark" ? "#f4fbff" : "#16324a",
            "line-width": stateCoreWidth as never,
            "line-opacity": 0.95,
          }}
        />
        <Layer
          id="state-names"
          type="symbol"
          filter={["==", ["get", "kind"], "label"]}
          minzoom={2.8}
          maxzoom={10.5}
          layout={{
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Bold"],
            "text-size": stateTextSize as never,
            "text-max-width": 12,
            "text-padding": 2,
            "text-letter-spacing": 0.02,
            "text-allow-overlap": false,
            "symbol-sort-key": ["get", "area"],
          }}
          paint={{
            "text-color": theme === "dark" ? "#f8fbff" : "#102033",
            "text-halo-color": theme === "dark" ? "#071018" : "#f7fbff",
            "text-halo-width": 2.1,
            "text-halo-blur": 0.3,
          }}
        />
      </Source>
      {showMesh && emphasizeMesh ? <MeshContours mesh={mesh} meshPulse={meshPulse} theme={theme} emphasis faded={showHoney} /> : null}
      {showHoney && honey?.features.length ? (
        <Source id="honey" type="geojson" data={honey}>
          <Layer
            id="honey-heat"
            type="fill"
            filter={["==", ["geometry-type"], "Polygon"]}
            paint={{
              "fill-color": ["get", "fill"] as never,
              "fill-opacity": ["get", "opacity"] as never,
            }}
          />
          <Layer
            id="honey-heat-line"
            type="line"
            filter={["==", ["geometry-type"], "Polygon"]}
            paint={{
              "line-color": ["get", "fill"] as never,
              "line-width": 1.25,
              "line-opacity": 0.85,
            }}
          />
          <Layer
            id="honey-pins"
            type="circle"
            filter={["==", ["geometry-type"], "Point"]}
            paint={{
              "circle-radius": ["case", ["==", ["get", "selected"], 1], 16, 13],
              "circle-color": ["get", "fill"] as never,
              "circle-stroke-color": theme === "dark" ? "#0b111a" : "#ffffff",
              "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 2],
            }}
          />
          <Layer
            id="honey-rank"
            type="symbol"
            filter={["==", ["geometry-type"], "Point"]}
            layout={{
              "text-field": ["to-string", ["get", "rank"]],
              "text-font": ["Noto Sans Bold"],
              "text-size": 11,
              "text-allow-overlap": true,
            }}
            paint={{
              "text-color": "#ffffff",
            }}
          />
        </Source>
      ) : null}
      {showPoints ? (
        <Source
          id="reports"
          type="geojson"
          data={points}
          cluster={clusterPoints}
          clusterRadius={clusterPoints ? 78 : undefined}
          clusterMaxZoom={clusterPoints ? 7 : undefined}
        >
          <Layer
            id="hail-cluster-halo"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": brand.halo,
              "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 22, 8, 30, 20, 40, 40, 48],
              "circle-opacity": 0.22,
            }}
          />
          <Layer
            id="hail-clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": brand.cluster,
              "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 15, 8, 21, 20, 28, 40, 34],
              "circle-stroke-color": brand.stroke,
              "circle-stroke-width": 2.5,
              "circle-opacity": 0.96,
            }}
          />
          <Layer
            id="hail-cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 12,
              "text-font": ["Noto Sans Bold"],
              "text-allow-overlap": true,
            }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="hail-point-halo"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-color": brand.halo,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 7, 10, 10],
              "circle-opacity": 0.28,
            }}
          />
          <Layer
            id="hail-point-hit"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-color": "#000000",
              "circle-radius": 22,
              "circle-opacity": 0,
            }}
          />
          <Layer
            id="hail-points"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-color": [...pointColor.slice(0, -1), brand.cluster] as never,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.2, 6, 4.6, 9, 6.5, 12, 9],
              "circle-stroke-color": [
                "case",
                ["==", ["get", "id"], selectedId ?? ""],
                brand.select,
                ["==", ["get", "hasPhoto"], 1],
                brand.select,
                brand.halo,
              ] as never,
              "circle-stroke-width": [
                "case",
                ["==", ["get", "id"], selectedId ?? ""],
                2.4,
                ["==", ["get", "hasPhoto"], 1],
                1.8,
                1,
              ] as never,
              "circle-opacity": 0.94,
            }}
          />
          <Layer
            id="history-cluster-count"
            type="symbol"
            filter={["all", [">", ["zoom"], 8], [">", ["coalesce", ["get", "clusterCount"], 0], 1], ["!", ["has", "point_count"]]]}
            layout={{
              "text-field": ["to-string", ["get", "clusterCount"]],
              "text-size": 11,
              "text-font": ["Noto Sans Bold"],
              "text-allow-overlap": true,
            }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="hazard-mark"
            type="symbol"
            filter={[
              "all",
              ["!", ["has", "point_count"]],
              ["any", ["==", ["get", "hazard"], "wind"], ["==", ["get", "hazard"], "tornado"]],
            ]}
            layout={{
              "icon-image": ["match", ["get", "hazard"], "wind", "mark-wind", "tornado", "mark-tornado", "mark-wind"],
              "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.34, 7, 0.46, 11, 0.58],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            }}
          />
        </Source>
      ) : null}
      {dealers?.features.length ? (
        <Source id="dealers" type="geojson" data={dealers}>
          <Layer
            id="dealer-hit"
            type="circle"
            paint={{ "circle-color": "#000000", "circle-radius": 22, "circle-opacity": 0 }}
          />
          <Layer
            id="dealer-pins"
            type="circle"
            paint={{
              "circle-color": "#0c6278",
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5, 10, 8, 14, 11],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            }}
          />
        </Source>
      ) : null}
      {canvassPins?.features.length ? (
        <Source id="canvass-pins" type="geojson" data={canvassPins}>
          <Layer
            id="canvass-hit"
            type="circle"
            paint={{ "circle-color": "#000000", "circle-radius": 22, "circle-opacity": 0 }}
          />
          <Layer
            id="canvass-pins"
            type="circle"
            paint={{
              "circle-color": [
                "match",
                ["get", "status"],
                "knocked",
                CANVASS_COLORS.knocked,
                "not_home",
                CANVASS_COLORS.not_home,
                "interested",
                CANVASS_COLORS.interested,
                "signed",
                CANVASS_COLORS.signed,
                "#64748b",
              ],
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 13, 9, 16, 12],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            }}
          />
        </Source>
      ) : null}
      {fieldPins?.features.length ? (
        <Source id="field-pins" type="geojson" data={fieldPins}>
          <Layer
            id="field-pin-hit"
            type="circle"
            paint={{ "circle-color": "#000000", "circle-radius": 22, "circle-opacity": 0 }}
          />
          <Layer
            id="field-pins"
            type="circle"
            paint={{
              "circle-color": [
                "match",
                ["get", "status"],
                "damage",
                "#be123c",
                "talked",
                "#0f766e",
                "lead",
                "#ca8a04",
                "#64748b",
              ],
              "circle-radius": 8,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            }}
          />
        </Source>
      ) : null}
      {userLocation ? (
        <Marker longitude={userLocation.lon} latitude={userLocation.lat} anchor="center">
          <span className="user-dot-hit">
            <span className="user-dot" aria-label="Your location" />
          </span>
        </Marker>
      ) : null}
      {draftPin ? (
        <Marker
          longitude={draftPin.lon}
          latitude={draftPin.lat}
          anchor="center"
          draggable={pickMode}
          onDragEnd={(event) => onPickLocation(event.lngLat.lng, event.lngLat.lat)}
        >
          <span className="draft-pin" />
        </Marker>
      ) : null}
    </Map>
  );
}

function glyphCanvas(draw: (ctx: CanvasRenderingContext2D) => void): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(64, 64);
  draw(ctx);
  return ctx.getImageData(0, 0, 64, 64);
}

function windGlyph(): ImageData {
  return glyphCanvas((ctx) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    for (const y of [20, 32, 44]) {
      ctx.beginPath();
      ctx.moveTo(12, y + 3);
      ctx.quadraticCurveTo(32, y - 8, 52, y + 3);
      ctx.stroke();
    }
  });
}

function tornadoGlyph(): ImageData {
  return glyphCanvas((ctx) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(32, 22, 12, 0.2, Math.PI * 1.65);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(33, 36, 7.5, Math.PI * 0.85, Math.PI * 2.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(32, 43);
    ctx.lineTo(32, 54);
    ctx.stroke();
  });
}

function numberProp(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const SWATH_FADE_MS = 420;

function isRadarLayer(id?: string): boolean {
  if (!id || id.endsWith("-line")) return false;
  return id === "mesh-fill" || id === "mesh-pulse-fill" || id.startsWith("mesh-a") || id.startsWith("mesh-b") || id.startsWith("mesh-pulse-");
}

function useCrossfade(data: GeoJSON.FeatureCollection | null): { current: 0 | 1; items: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection] } {
  const [slots, setSlots] = useState<{ current: 0 | 1; items: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection] }>({
    current: 0,
    items: [data ?? EMPTY_COLLECTION, EMPTY_COLLECTION],
  });
  const first = useRef(true);
  useEffect(() => {
    const nextData = data ?? EMPTY_COLLECTION;
    if (first.current) {
      first.current = false;
      setSlots({ current: 0, items: [nextData, EMPTY_COLLECTION] });
      return;
    }
    setSlots((prev) => {
      const next = prev.current === 0 ? 1 : 0;
      const items: [GeoJSON.FeatureCollection, GeoJSON.FeatureCollection] = [prev.items[0], prev.items[1]];
      items[next] = nextData;
      return { current: next, items };
    });
  }, [data]);
  return slots;
}

function MeshContours({
  mesh,
  meshPulse,
  theme,
  emphasis,
  faded = false,
}: {
  mesh: GeoJSON.FeatureCollection | null;
  meshPulse: GeoJSON.FeatureCollection | null;
  theme: "light" | "dark";
  emphasis: boolean;
  faded?: boolean;
}) {
  const meshFade = useCrossfade(mesh);
  const pulseFade = useCrossfade(meshPulse);
  const fill = faded ? 0.28 : theme === "dark" ? 0.48 : 0.52;
  const lineWidth = 1.75;
  const lineOpacity = faded ? 0.7 : 1;
  const pulseFill = 0.55 * (faded ? 0.5 : 1);
  if (!emphasis) {
    return (
      <>
        <SwathSource id="mesh" data={mesh} fill={fill} lineWidth={lineWidth} lineOpacity={lineOpacity} blur={0} theme={theme} labels />
        <SwathSource id="mesh-pulse" data={meshPulse} fill={pulseFill} lineWidth={lineWidth} lineOpacity={0.95} blur={0} theme={theme} />
      </>
    );
  }
  return (
    <>
      {meshFade.items.map((collection, index) => (
        <SwathSource
          key={`mesh-${index}`}
          id={index === 0 ? "mesh-a" : "mesh-b"}
          data={collection}
          fill={meshFade.current === index ? fill : 0}
          lineWidth={lineWidth}
          lineOpacity={meshFade.current === index ? lineOpacity : 0}
          blur={0}
          fade
          labels={meshFade.current === index}
          theme={theme}
        />
      ))}
      {pulseFade.items.map((collection, index) => (
        <SwathSource
          key={`pulse-${index}`}
          id={index === 0 ? "mesh-pulse-a" : "mesh-pulse-b"}
          data={collection}
          fill={pulseFade.current === index ? pulseFill : 0}
          lineWidth={2.4}
          lineOpacity={pulseFade.current === index ? 0.95 : 0}
          blur={0}
          fade
          theme={theme}
        />
      ))}
    </>
  );
}

function SwathSource({
  id,
  data,
  fill,
  lineWidth,
  lineOpacity,
  blur,
  fade = false,
  labels = false,
  theme,
}: {
  id: string;
  data: GeoJSON.FeatureCollection | null;
  fill: number;
  lineWidth: number;
  lineOpacity: number;
  blur: number;
  fade?: boolean;
  labels?: boolean;
  theme: "light" | "dark";
}) {
  if (!data?.features.length && !fade) return null;
  const transition = fade ? { duration: SWATH_FADE_MS, delay: 0 } : undefined;
  return (
    <Source id={id} type="geojson" data={data ?? EMPTY_COLLECTION}>
      <Layer
        id={`${id}-fill`}
        type="fill"
        filter={["==", ["geometry-type"], "Polygon"]}
        paint={
          {
            "fill-color": swathColor as never,
            "fill-opacity": fill,
            ...(transition ? { "fill-opacity-transition": transition } : {}),
          } as never
        }
      />
      <Layer
        id={`${id}-halo`}
        type="line"
        filter={["==", ["geometry-type"], "LineString"]}
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={
          {
            "line-color": swathColor as never,
            "line-width": lineWidth + 3.2,
            "line-opacity": lineOpacity > 0 ? Math.min(0.96, lineOpacity) : 0,
            "line-blur": Math.min(blur, 0.15),
            ...(transition ? { "line-opacity-transition": transition } : {}),
          } as never
        }
      />
      <Layer
        id={`${id}-line`}
        type="line"
        filter={["==", ["geometry-type"], "Polygon"]}
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={
          {
            "line-color": swathColor as never,
            "line-width": lineWidth,
            "line-opacity": lineOpacity,
            "line-blur": 0,
            ...(transition ? { "line-opacity-transition": transition } : {}),
          } as never
        }
      />
      {labels ? (
        <Layer
          id={`${id}-label`}
          type="symbol"
          minzoom={9}
          filter={["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "showLabel"], true]]}
          layout={{
            "text-field": ["coalesce", ["get", "mapLabel"], ""],
            "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 9, 12, 12, 15],
            "text-allow-overlap": false,
            "text-padding": 6,
            "text-optional": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "#102033",
            "text-halo-width": 2,
            "text-halo-blur": 0.15,
          }}
        />
      ) : null}
    </Source>
  );
}

function subsetThreats(collection: GeoJSON.FeatureCollection | null, kinds: string[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (collection?.features ?? []).filter((feature) => kinds.includes(String(feature.properties?.kind ?? ""))),
  };
}
