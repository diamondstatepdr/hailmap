export interface AreaSelection {
  id: string;
  label: string;
  source: "mesh" | "reports" | "view";
  minIn: number | null;
  maxIn: number | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface DealerPin {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  distanceKm: number;
  kind: "dealership" | "lot";
}

export interface RadarDay {
  date: string | null;
  label: string;
  maxIn: number | null;
  validTime: string | null;
  product: string;
  status: "ok" | "empty" | "error";
}

export interface RadarSample {
  status: "ok" | "empty" | "partial" | "error";
  maxIn: number | null;
  days: RadarDay[];
  note: string | null;
  label: string;
}
