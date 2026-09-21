"use client";

import { useEffect, useRef } from "react";
import Map, {
  Layer,
  NavigationControl,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

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
}

interface Props {
  theme: "light" | "dark";
  points: GeoJSON.FeatureCollection;
  swaths: GeoJSON.FeatureCollection;
  income: GeoJSON.FeatureCollection | null;
  showPoints: boolean;
  showSwaths: boolean;
  showIncome: boolean;
  selectedId: string | null;
  focus: MapFocus | null;
  onSelectReport: (id: string) => void;
  onSelectCounty: (info: { fips?: string; income: number | null }) => void;
}

export default function HailMap({
  theme,
  points,
  swaths,
  income,
  showPoints,
  showSwaths,
  showIncome,
  selectedId,
  focus,
  onSelectReport,
  onSelectCounty,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const interactiveLayerIds = [
    showPoints ? "hail-points" : "",
    showIncome ? "income-fill" : "",
  ].filter(Boolean);

  useEffect(() => {
    if (!focus) return;
    mapRef.current?.flyTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(mapRef.current.getZoom(), 7.2),
      duration: 700,
    });
  }, [focus]);

  function onClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (!feature) return;
    const props = feature.properties ?? {};
    if (feature.layer?.id === "hail-points" && props.id) {
      onSelectReport(String(props.id));
      return;
    }
    if (feature.layer?.id === "income-fill") {
      const incomeValue = props.income == null || props.income === "null" ? null : Number(props.income);
      onSelectCounty({
        fips: props.fips ? String(props.fips) : undefined,
        income: incomeValue != null && Number.isFinite(incomeValue) ? incomeValue : null,
      });
    }
  }

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: -97.5, latitude: 39.2, zoom: 3.7 }}
      mapStyle={theme === "dark" ? DARK_STYLE : LIGHT_STYLE}
      interactiveLayerIds={interactiveLayerIds}
      onClick={onClick}
      onMouseMove={(event) => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = event.features?.length ? "pointer" : "";
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
      {showPoints ? (
        <Source id="reports" type="geojson" data={points}>
          <Layer
            id="hail-points"
            type="circle"
            paint={{
              "circle-color": sizeColor as never,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4.5, 6, 7, 10, 12],
              "circle-stroke-color": theme === "dark" ? "#0e141c" : "#ffffff",
              "circle-stroke-width": ["case", ["==", ["get", "id"], selectedId ?? ""], 3, 1.25],
              "circle-opacity": 0.95,
            }}
          />
        </Source>
      ) : null}
    </Map>
  );
}
