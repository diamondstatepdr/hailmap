import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { FeedStatus } from "@/lib/types";

export type ThreatKind = "outlook" | "significant" | "watch" | "warning" | "statement";

export interface ThreatProperties {
  id: string;
  kind: ThreatKind;
  event: string;
  category: string;
  office: string;
  until: string;
  hazard: string;
  area: string;
  fill: string;
  stroke: string;
  rank: number;
}

export type ThreatFeature = Feature<Polygon | MultiPolygon, ThreatProperties>;

export interface ThreatInfo {
  id: string;
  kind: string;
  event: string;
  category: string;
  office: string;
  until: string;
  hazard: string;
  area: string;
}

export interface ThreatFeedStatus {
  nws: FeedStatus;
  spc: FeedStatus;
}

export interface ThreatsResponse {
  updatedAt: string;
  syncedAt: string;
  status: ThreatFeedStatus;
  collection: FeatureCollection;
}

export const SPC_DAY1_CATEGORICAL_URL =
  "https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson";

export const SPC_SIGNIFICANT_URLS = {
  hail: "https://www.spc.noaa.gov/products/outlook/day1otlk_sighail.lyr.geojson",
  tornado: "https://www.spc.noaa.gov/products/outlook/day1otlk_sigtorn.lyr.geojson",
  wind: "https://www.spc.noaa.gov/products/outlook/day1otlk_sigwind.lyr.geojson",
} as const;

export type SignificantProduct = keyof typeof SPC_SIGNIFICANT_URLS;

const NWS_EVENTS = [
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Tornado Watch",
  "Severe Thunderstorm Watch",
  "Special Weather Statement",
] as const;

export const OUTLOOK_LEVELS = [
  { category: "marginal", label: "Marginal", fill: "#66A366", stroke: "#005500" },
  { category: "slight", label: "Slight", fill: "#FFE066", stroke: "#DDAA00" },
  { category: "enhanced", label: "Enhanced", fill: "#FFA366", stroke: "#FF6600" },
  { category: "moderate", label: "Moderate", fill: "#E06666", stroke: "#CC0000" },
  { category: "high", label: "High", fill: "#EE99EE", stroke: "#CC00CC" },
] as const;

export const SIGNIFICANT_COLOR = "#6d28d9";

export const THREAT_LEGEND = [
  { label: "Tornado warning", event: "Tornado Warning", fill: "#dc2626", dashed: false },
  { label: "Thunderstorm warning", event: "Severe Thunderstorm Warning", fill: "#ea580c", dashed: false },
  { label: "Tornado watch", event: "Tornado Watch", fill: "#7c3aed", dashed: true },
  { label: "Thunderstorm watch", event: "Severe Thunderstorm Watch", fill: "#d97706", dashed: true },
  { label: "Hail statement", event: "Special Weather Statement", fill: "#0284c7", dashed: true },
] as const;

const OUTLOOK_BY_CODE: Record<
  string,
  { category: string; event: string; hazard: string; fill: string; stroke: string; rank: number }
> = {
  MRGL: {
    category: "marginal",
    event: "Marginal risk",
    hazard: "Isolated severe storms are possible, including hail, damaging wind, or a brief tornado.",
    fill: "#66A366",
    stroke: "#005500",
    rank: 1,
  },
  SLGT: {
    category: "slight",
    event: "Slight risk",
    hazard: "Scattered severe storms are possible. Hail and damaging wind are the main threats.",
    fill: "#FFE066",
    stroke: "#DDAA00",
    rank: 2,
  },
  ENH: {
    category: "enhanced",
    event: "Enhanced risk",
    hazard: "Several severe storms are possible, with a greater chance of large hail or wind damage.",
    fill: "#FFA366",
    stroke: "#FF6600",
    rank: 3,
  },
  MDT: {
    category: "moderate",
    event: "Moderate risk",
    hazard: "Widespread severe storms are expected. Significant hail, wind, or tornadoes are possible.",
    fill: "#E06666",
    stroke: "#CC0000",
    rank: 4,
  },
  HIGH: {
    category: "high",
    event: "High risk",
    hazard: "A high risk of severe weather. A major outbreak of severe storms is expected.",
    fill: "#EE99EE",
    stroke: "#CC00CC",
    rank: 5,
  },
};

const LABEL2_CODE: Record<string, string> = {
  "marginal risk": "MRGL",
  "slight risk": "SLGT",
  "enhanced risk": "ENH",
  "moderate risk": "MDT",
  "high risk": "HIGH",
};

const DN_CODE: Record<number, string> = {
  3: "MRGL",
  4: "SLGT",
  5: "ENH",
  6: "MDT",
  8: "HIGH",
};

const SIG_COPY: Record<SignificantProduct, { event: string; hazard: string }> = {
  hail: {
    event: "Significant hail",
    hazard: "Hail of 2 inches or larger is possible inside this hatched area.",
  },
  tornado: {
    event: "Significant tornadoes",
    hazard: "Strong tornadoes, EF2 or greater, are possible inside this hatched area.",
  },
  wind: {
    event: "Significant wind",
    hazard: "Wind gusts of 75 mph or stronger are possible inside this hatched area.",
  },
};

const WATCH_HAZARD: Record<string, string> = {
  "Tornado Watch": "Conditions are favorable for tornadoes. Large hail and damaging winds are also possible.",
  "Severe Thunderstorm Watch":
    "Conditions are favorable for severe thunderstorms with large hail and damaging winds.",
};

const EVENT_KIND: Record<string, ThreatKind> = {
  "Tornado Warning": "warning",
  "Severe Thunderstorm Warning": "warning",
  "Tornado Watch": "watch",
  "Severe Thunderstorm Watch": "watch",
  "Special Weather Statement": "statement",
};

export function nwsThreatsUrl(): string {
  const params = new URLSearchParams();
  params.set("status", "actual");
  params.set("message_type", "alert");
  for (const event of NWS_EVENTS) params.append("event", event);
  return `https://api.weather.gov/alerts/active?${params.toString()}`;
}

export function threatFromProperties(props: Record<string, unknown> | null | undefined): ThreatInfo | null {
  if (!props) return null;
  const event = text(props.event);
  if (!event) return null;
  return {
    id: text(props.id) || event,
    kind: text(props.kind),
    event,
    category: text(props.category),
    office: text(props.office),
    until: text(props.until),
    hazard: text(props.hazard),
    area: text(props.area),
  };
}

export function alertsToFeatures(payload: unknown): ThreatFeature[] {
  const features = featureList(payload);
  const parsed: ThreatFeature[] = [];
  for (const feature of features) {
    const props = asRecord(feature.properties);
    if (!props) continue;
    const event = text(props.event);
    const kind = EVENT_KIND[event];
    if (!kind) continue;
    if (text(props.messageType) && text(props.messageType) !== "Alert") continue;
    if (text(props.status) && text(props.status) !== "Actual") continue;
    const description = text(props.description);
    const headline = text(props.headline);
    if (kind === "statement" && !/hail/i.test(`${event} ${headline} ${description}`)) continue;
    const geometry = toPolygon(feature.geometry);
    if (!geometry) continue;
    const params = asRecord(props.parameters) ?? {};
    const colors = THREAT_LEGEND.find((item) => item.event === event);
    parsed.push(
      featureOf(geometry, {
        id: text(props.id) || text(feature.id) || `${event}-${parsed.length}`,
        kind,
        event,
        category: "",
        office: text(props.senderName) || "National Weather Service",
        until: text(props.ends) || text(props.expires),
        hazard: alertHazard(event, kind, description, params),
        area: clipText(text(props.areaDesc), 220),
        fill: colors?.fill ?? "#64748b",
        stroke: colors?.fill ?? "#64748b",
        rank: kind === "warning" ? 30 : kind === "statement" ? 20 : 10,
      }),
    );
  }
  return parsed;
}

export function outlookToFeatures(payload: unknown, now = Date.now()): ThreatFeature[] {
  const parsed: ThreatFeature[] = [];
  for (const feature of featureList(payload)) {
    const props = asRecord(feature.properties);
    if (!props || !stillValid(props, now)) continue;
    const code = categoryCode(props);
    const level = code ? OUTLOOK_BY_CODE[code] : undefined;
    if (!level) continue;
    const geometry = toPolygon(feature.geometry);
    if (!geometry) continue;
    parsed.push(
      featureOf(geometry, {
        id: `spc-day1-${level.category}-${text(props.VALID) || "na"}-${parsed.length}`,
        kind: "outlook",
        event: level.event,
        category: level.category,
        office: "Storm Prediction Center",
        until: text(props.EXPIRE_ISO),
        hazard: level.hazard,
        area: "",
        fill: hexColor(props.fill) || level.fill,
        stroke: hexColor(props.stroke) || level.stroke,
        rank: level.rank,
      }),
    );
  }
  return parsed;
}

export function significantToFeatures(
  payload: unknown,
  product: SignificantProduct,
  now = Date.now(),
): ThreatFeature[] {
  const copy = SIG_COPY[product];
  const parsed: ThreatFeature[] = [];
  for (const feature of featureList(payload)) {
    const props = asRecord(feature.properties);
    if (!props || !isSignificant(props, now)) continue;
    const geometry = toPolygon(feature.geometry);
    if (!geometry) continue;
    parsed.push(
      featureOf(geometry, {
        id: `spc-day1-sig-${product}-${text(props.VALID) || "na"}-${parsed.length}`,
        kind: "significant",
        event: copy.event,
        category: "significant",
        office: "Storm Prediction Center",
        until: text(props.EXPIRE_ISO),
        hazard: copy.hazard,
        area: "",
        fill: SIGNIFICANT_COLOR,
        stroke: SIGNIFICANT_COLOR,
        rank: 8,
      }),
    );
  }
  return parsed;
}

export function assembleThreats(input: {
  alerts: unknown | null;
  categorical: unknown | null;
  significant: Array<{ product: SignificantProduct; payload: unknown | null }>;
  now?: number;
}): { features: ThreatFeature[]; status: ThreatFeedStatus } {
  const now = input.now ?? Date.now();
  const alerts = input.alerts == null ? [] : alertsToFeatures(input.alerts);
  const outlook = input.categorical == null ? [] : outlookToFeatures(input.categorical, now);
  const significant = input.significant.flatMap((item) =>
    item.payload == null ? [] : significantToFeatures(item.payload, item.product, now),
  );
  const features = [...outlook, ...significant, ...alerts].sort((a, b) => a.properties.rank - b.properties.rank);
  const categoricalFailed = input.categorical == null;
  const spcStatus: FeedStatus = categoricalFailed
    ? significant.length
      ? "ok"
      : "error"
    : outlook.length || significant.length
      ? "ok"
      : "empty";
  return {
    features,
    status: {
      nws: input.alerts == null ? "error" : alerts.length ? "ok" : "empty",
      spc: spcStatus,
    },
  };
}

function alertHazard(
  event: string,
  kind: ThreatKind,
  description: string,
  params: Record<string, unknown>,
): string {
  const noted = damageNote(params);
  const line = hazardLine(description);
  if (line) {
    const hail = hailPhrase(paramValue(params, "maxHailSize"));
    const withHail = hail && !/hail/i.test(line) ? `${line}. ${capitalize(hail)} is also possible` : line;
    return joinHazard(withHail, noted);
  }
  if (kind === "watch") return WATCH_HAZARD[event] ?? "Severe weather is possible in this watch.";
  if (kind === "statement") {
    return (
      sentenceWith(`${description}`, /hail/i) ||
      "A special weather statement mentions hail."
    );
  }
  if (event === "Tornado Warning") {
    const detection = paramValue(params, "tornadoDetection");
    let sentence = "A tornado is possible.";
    if (/observed/i.test(detection)) sentence = "A tornado has been observed.";
    else if (/radar/i.test(detection)) sentence = "Radar indicates a tornado.";
    const hail = hailPhrase(paramValue(params, "maxHailSize"));
    if (hail) sentence = `${sentence.replace(/\.$/, "")}. ${capitalize(hail)} is also possible.`;
    return joinHazard(sentence.replace(/\.$/, ""), noted);
  }
  const hail = hailPhrase(paramValue(params, "maxHailSize"));
  const wind = windPhrase(paramValue(params, "maxWindGust"));
  let sentence = "Damaging winds and hail are expected.";
  if (hail && wind) sentence = `${capitalize(wind)} and ${hail}.`;
  else if (hail) sentence = `${capitalize(hail)} is expected.`;
  else if (wind) sentence = `${capitalize(wind)} are expected.`;
  return joinHazard(sentence.replace(/\.$/, ""), noted);
}

function joinHazard(base: string, note: string): string {
  const sentence = /[.!?]$/.test(base) ? base : `${base}.`;
  if (!note) return sentence;
  if (sentence.toLowerCase().includes(note.toLowerCase().replace(/\.$/, "").slice(0, 18))) return sentence;
  return `${sentence} ${note}`;
}

function damageNote(params: Record<string, unknown>): string {
  const tornado = paramValue(params, "tornadoDamageThreat");
  const storm = paramValue(params, "thunderstormDamageThreat");
  if (/catastrophic/i.test(tornado)) return "This is a tornado emergency.";
  if (/destructive/i.test(storm)) return "Destructive storm damage is possible.";
  if (/considerable/i.test(`${tornado} ${storm}`)) return "Damage threat is considerable.";
  return "";
}

function hazardLine(description: string): string | null {
  const match = description.match(/HAZARD\.{2,}\s*([^\n]+)/i);
  if (!match) return null;
  const textValue = match[1].replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (textValue.length < 4 || /see text/i.test(textValue)) return null;
  return textValue;
}

function hailPhrase(raw: string): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0 || size > 10) return null;
  const inches = Number.isInteger(size) ? String(size) : String(Math.round(size * 100) / 100);
  return `${/up to/i.test(raw) ? "up to " : ""}${inches} inch hail`;
}

function windPhrase(raw: string): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d+)/);
  if (!match) return null;
  return `${match[1]} mph wind gusts`;
}

function sentenceWith(value: string, pattern: RegExp): string | null {
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const parts = flat.split(/(?<=[.!?])\s+/);
  const hit = parts.find((part) => pattern.test(part));
  if (!hit) return null;
  const sentence = hit.trim();
  return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}…` : sentence;
}

function categoryCode(props: Record<string, unknown>): string | null {
  const label = text(props.LABEL).toUpperCase();
  if (OUTLOOK_BY_CODE[label]) return label;
  const fromLabel = LABEL2_CODE[text(props.LABEL2).toLowerCase()];
  if (fromLabel) return fromLabel;
  const dn = Number(props.DN);
  return DN_CODE[dn] ?? null;
}

function isSignificant(props: Record<string, unknown>, now: number): boolean {
  if (!stillValid(props, now)) return false;
  const label = text(props.LABEL).toUpperCase();
  const dn = Number(props.DN);
  if (label === "SIGN" || label === "SIG" || label.startsWith("SIGN")) return true;
  if ((!label || /^[0-9.]+$/.test(label)) && Number.isFinite(dn) && dn > 0) return true;
  return false;
}

function stillValid(props: Record<string, unknown>, now: number): boolean {
  const expire = Date.parse(text(props.EXPIRE_ISO));
  return !Number.isNaN(expire) && expire > now;
}

function featureOf(geometry: Polygon | MultiPolygon, properties: ThreatProperties): ThreatFeature {
  return { type: "Feature", geometry, properties };
}

function featureList(payload: unknown): Array<{ geometry?: unknown; properties?: unknown; id?: unknown }> {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.features)) return [];
  return root.features.flatMap((feature) => {
    const record = asRecord(feature);
    return record ? [record] : [];
  });
}

function toPolygon(geometry: unknown): Polygon | MultiPolygon | null {
  const parts = polygonParts(geometry);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const coordinates: MultiPolygon["coordinates"] = [];
  for (const part of parts) {
    if (part.type === "Polygon") coordinates.push(part.coordinates);
    else coordinates.push(...part.coordinates);
  }
  return { type: "MultiPolygon", coordinates };
}

function polygonParts(geometry: unknown): Array<Polygon | MultiPolygon> {
  const record = asRecord(geometry);
  if (!record) return [];
  if ((record.type === "Polygon" || record.type === "MultiPolygon") && Array.isArray(record.coordinates) && record.coordinates.length) {
    return [record as unknown as Polygon | MultiPolygon];
  }
  if (record.type === "GeometryCollection" && Array.isArray(record.geometries)) {
    return record.geometries.flatMap((child) => polygonParts(child));
  }
  return [];
}

function hexColor(value: unknown): string | null {
  const color = text(value);
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;
}

function paramValue(params: Record<string, unknown>, key: string): string {
  const found = Object.keys(params).find((item) => item.toLowerCase() === key.toLowerCase());
  if (!found) return "";
  const value = params[found];
  if (Array.isArray(value)) return value.map((item) => String(item)).join(" ");
  if (value == null) return "";
  return String(value);
}

function clipText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/[\s,;]+$/, "")}…`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
