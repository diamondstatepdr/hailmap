"use client";

import { useEffect, useMemo, useRef } from "react";
import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, FilterSpecification } from "maplibre-gl";
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import stateOverlay from "@/data/us-states.json";
import { SIGNIFICANT_COLOR, THREAT_LEGEND, threatFromProperties, type ThreatInfo } from "@/lib/threats";
import "maplibre-gl/dist/maplibre-gl.css";

const states = stateOverlay as FeatureCollection;

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/positron";
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

const sizeColor = [
  "case",
  ["==", ["typeof", ["get", "sizeIn"]], "number"],
  [
    "interpolate",
    ["linear"],
    ["get", "sizeIn"],
    0.25,
    "#16a34a",
    1,
    "#ca8a04",
    1.75,
    "#ea580c",
    2.5,
    "#dc2626",
    4,
    "#7c3aed",
  ],
  "#64748b",
];

const stateCoreWidth = ["interpolate", ["linear"], ["zoom"], 2, 1.5, 3.6, 2.15, 6, 2.7, 9, 3.5];
const stateCasingWidth = ["interpolate", ["linear"], ["zoom"], 2, 3.6, 3.6, 4.6, 6, 5.4, 9, 6.4];
const stateTextSize = ["interpolate", ["linear"], ["zoom"], 3, 12, 4.5, 15, 6.5, 18, 9, 23];

const swathColor = [
  "case",
  ["==", ["typeof", ["get", "maxSizeIn"]], "number"],
  [
    "interpolate",
    ["linear"],
    ["get", "maxSizeIn"],
    0.25,
    "#16a34a",
    1,
    "#ca8a04",
    1.75,
    "#ea580c",
    2.5,
    "#dc2626",
    4,
    "#7c3aed",
  ],
  "#64748b",
];

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
  income: GeoJSON.FeatureCollection | null;
  threats: GeoJSON.FeatureCollection | null;
  showPoints: boolean;
  showSwaths: boolean;
  showIncome: boolean;
  showThreats: boolean;
  showOutlook: boolean;
  selectedId: string | null;
  focus: MapFocus | null;
  frame: MapFrame | null;
  draftPin: { lat: number; lon: number } | null;
  pickMode: boolean;
  blockSelection: boolean;
  onPickLocation: (lon: number, lat: number) => void;
  onSelectReport: (id: string) => void;
  onSelectCounty: (info: { fips?: string; income: number | null }) => void;
  onSelectThreat: (info: ThreatInfo) => void;
}

export default function HailMap({
  theme,
  points,
  swaths,
  income,
  threats,
  showPoints,
  showSwaths,
  showIncome,
  showThreats,
  showOutlook,
  selectedId,
  focus,
  frame,
  draftPin,
  pickMode,
  blockSelection,
  onPickLocation,
  onSelectReport,
  onSelectCounty,
  onSelectThreat,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const frameRef = useRef(frame);
  const frameWait = useRef(false);
  frameRef.current = frame;
  const outlookData = useMemo(() => subsetThreats(threats, ["outlook", "significant"]), [threats]);
  const alertData = useMemo(() => subsetThreats(threats, ["watch", "warning", "statement"]), [threats]);
  const interactiveLayerIds = [
    showPoints ? "hail-clusters" : "",
    showPoints ? "hail-points" : "",
    showThreats ? "threat-warning-fill" : "",
    showThreats ? "threat-watch-fill" : "",
    showThreats ? "threat-statement-fill" : "",
    showOutlook ? "outlook-fill" : "",
    showOutlook ? "significant-fill" : "",
    showIncome ? "income-fill" : "",
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
        if (frameRef.current?.nonce === next.nonce) applyFrame(next);
      });
      return;
    }
    map.fitBounds(
      [
        [next.west, next.south],
        [next.east, next.north],
      ],
      {
        padding: { top: 124, bottom: 232, left: 36, right: 48 },
        duration: 800,
        maxZoom: 8.2,
      },
    );
  }

  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    if (!map) return;
    const camera = {
      center: [focus.lon, focus.lat] as [number, number],
      zoom: focus.zoom ?? Math.max(map.getZoom(), 8),
      duration: 700,
    };
    map.flyTo(focus.zoom ? { ...camera, padding: { top: 96, bottom: 260, left: 28, right: 28 } } : camera);
  }, [focus]);

  useEffect(() => {
    applyFrame(frame);
  }, [frame]);

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
      if (feature.layer?.id === "hail-points" && props.id) {
        onSelectReport(String(props.id));
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
  }

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: -97.5, latitude: 39.2, zoom: 3.7 }}
      mapStyle={theme === "dark" ? DARK_STYLE : LIGHT_STYLE}
      onLoad={() => {
        quietBaseStateLayers();
        applyFrame();
      }}
      onStyleData={() => quietBaseStateLayers()}
      interactiveLayerIds={interactiveLayerIds}
      onClick={onClick}
      onMouseMove={(event) => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = pickMode ? "crosshair" : event.features?.length ? "pointer" : "";
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="top-right" showCompass={false} />
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
      {showSwaths ? (
        <Source id="swaths" type="geojson" data={swaths}>
          <Layer
            id="swath-fill"
            type="fill"
            paint={{
              "fill-color": swathColor as never,
              "fill-opacity": 0.28,
            }}
          />
          <Layer
            id="swath-line"
            type="line"
            paint={{
              "line-color": swathColor as never,
              "line-width": 1.5,
              "line-opacity": 0.85,
            }}
          />
        </Source>
      ) : null}
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
            "line-color": theme === "dark" ? "#f8fafc" : "#1e293b",
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
            "text-max-width": 8,
            "text-padding": 2,
            "text-letter-spacing": 0.04,
            "text-allow-overlap": false,
            "symbol-sort-key": ["get", "area"],
          }}
          paint={{
            "text-color": theme === "dark" ? "#f8fafc" : "#122033",
            "text-halo-color": theme === "dark" ? "#0b1220" : "#ffffff",
            "text-halo-width": 1.8,
            "text-halo-blur": 0.3,
          }}
        />
      </Source>
      {showPoints ? (
        <Source id="reports" type="geojson" data={points} cluster clusterRadius={52} clusterMaxZoom={5}>
          <Layer
            id="hail-clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": "#0f766e",
              "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 16, 8, 22, 20, 30, 40, 36],
              "circle-stroke-color": theme === "dark" ? "#042f2e" : "#ffffff",
              "circle-stroke-width": 2.5,
              "circle-opacity": 0.94,
            }}
          />
          <Layer
            id="hail-cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 13,
              "text-font": ["Noto Sans Regular"],
              "text-allow-overlap": true,
            }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="hail-points"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-color": sizeColor as never,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 8, 6, 11, 10, 15],
              "circle-stroke-color": [
                "case",
                ["==", ["get", "id"], selectedId ?? ""],
                theme === "dark" ? "#2dd4bf" : "#0f766e",
                ["==", ["get", "hasPhoto"], 1],
                theme === "dark" ? "#2dd4bf" : "#0f766e",
                theme === "dark" ? "#0e141c" : "#ffffff",
              ] as never,
              "circle-stroke-width": [
                "case",
                ["==", ["get", "id"], selectedId ?? ""],
                4,
                ["==", ["get", "hasPhoto"], 1],
                3,
                2,
              ] as never,
              "circle-opacity": 0.96,
            }}
          />
        </Source>
      ) : null}
      {draftPin ? (
        <Marker
          longitude={draftPin.lon}
          latitude={draftPin.lat}
          anchor="center"
          draggable={pickMode}
          onDragEnd={(event) => onPickLocation(event.lngLat.lng, event.lngLat.lat)}
        >
          <span className="block h-7 w-7 rounded-full border-[3px] border-white bg-accent shadow-sheet" />
        </Marker>
      ) : null}
    </Map>
  );
}

function subsetThreats(collection: GeoJSON.FeatureCollection | null, kinds: string[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (collection?.features ?? []).filter((feature) => kinds.includes(String(feature.properties?.kind ?? ""))),
  };
}
