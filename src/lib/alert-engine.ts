import { ensureFresh } from "@/lib/ingest";
import { getMeta, listRecentReports, setMeta } from "@/lib/db";
import { meshLayerFor } from "@/lib/mesh-cache";
import { planMesh } from "@/lib/mesh-plan";
import { getLiveThreats } from "@/lib/live-threats";
import {
  alertCopy,
  alertLink,
  matchAreas,
  meshCandidates,
  outlookCandidates,
  reportCandidates,
  warningCandidates,
  type HailCandidate,
  type WatchTarget,
} from "@/lib/alert-match";
import { inQuietHours } from "@/lib/alert-model";
import {
  alertCounts,
  claimEvent,
  deleteDevice,
  listDevices,
  listRetryEvents,
  markEvent,
  type AlertArea,
  type PushDevice,
} from "@/lib/alert-store";
import { intersectsState, stateLabel, stateOf } from "@/lib/state-locate";
import type { ThreatFeature, ThreatProperties } from "@/lib/threats";
import { haversineKm } from "@/lib/geo";
import { getVapid } from "@/lib/vapid";
import { sendWebPush } from "@/lib/web-push-send";

const REPORT_LOOKBACK_MS = 18 * 3600 * 1000;
const LOCATE = { stateOf, intersects: intersectsState };

export interface CycleResult {
  status: "ok" | "idle" | "error";
  subscriptions: number;
  areas: number;
  candidates: number;
  sent: number;
  quiet: number;
  expired: number;
  failed: number;
}

function toTarget(area: AlertArea, device: PushDevice): WatchTarget {
  const near = area.kind === "near";
  return {
    id: area.id,
    kind: area.kind,
    label: area.label,
    lat: near ? device.lat : area.lat,
    lon: near ? device.lon : area.lon,
    radiusMi: area.radiusMi || 25,
    state: area.state,
    minSizeIn: area.minSizeIn,
    mesh: area.mesh,
    reports: area.reports,
    warnings: area.warnings,
    outlook: area.outlook,
  };
}

async function loadCandidates(now: Date): Promise<HailCandidate[]> {
  await ensureFresh();
  const since = now.getTime() - REPORT_LOOKBACK_MS;
  const reports = listRecentReports(2)
    .filter((report) => report.hazard === "hail" && (report.source === "spc" || report.source === "iem"))
    .filter((report) => Date.parse(report.occurredAt) >= since)
    .map((report) => ({
      id: report.id,
      lat: report.lat,
      lon: report.lon,
      sizeIn: report.sizeIn,
      occurredAt: report.occurredAt,
      location: report.location,
      state: report.state,
    }));

  const placeFor = (lat: number, lon: number) => {
    let best: (typeof reports)[number] | null = null;
    let bestKm = 64;
    for (const report of reports) {
      const km = haversineKm(lat, lon, report.lat, report.lon);
      if (km < bestKm) {
        best = report;
        bestKm = km;
      }
    }
    if (best?.location) return [best.location, best.state].filter(Boolean).join(", ");
    const code = stateOf(lat, lon);
    const name = code ? stateLabel(code) : "United States";
    const latHem = lat >= 0 ? "N" : "S";
    const lonHem = lon >= 0 ? "E" : "W";
    return `${name} · ${Math.abs(lat).toFixed(1)}°${latHem}, ${Math.abs(lon).toFixed(1)}°${lonHem}`;
  };

  const meshPlan = planMesh({ hours: 1, now });
  const mesh =
    "error" in meshPlan
      ? []
      : await meshLayerFor(meshPlan, now)
          .then((layer) => meshCandidates(layer.collection, layer.validTime ?? now.toISOString(), placeFor))
          .catch((error) => {
            console.error("[hailmap] alerts mesh", error instanceof Error ? error.message : error);
            return [];
          });

  const threats = await getLiveThreats().catch((error) => {
    console.error("[hailmap] alerts threats", error instanceof Error ? error.message : error);
    return null;
  });
  const features = (threats?.collection.features ?? []) as ThreatFeature[];
  const typed = features.filter((feature): feature is ThreatFeature => {
    const props = feature.properties as ThreatProperties | null;
    return Boolean(props && feature.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"));
  });

  return [
    ...mesh,
    ...reportCandidates(reports),
    ...warningCandidates(typed, now),
    ...outlookCandidates(typed, now),
  ];
}

async function pushToDevice(device: PushDevice, title: string, body: string, url: string, tag: string): Promise<"sent" | "expired" | "failed" | "quiet"> {
  if (inQuietHours(new Date(), device.quietStart, device.quietEnd, device.timeZone)) return "quiet";
  const result = await sendWebPush(
    { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
    { title, body, url, tag },
  );
  if (result === "expired") deleteDevice(device.id);
  return result;
}

export async function runAlertCycle(now = new Date()): Promise<CycleResult> {
  getVapid();
  const devices = listDevices();
  const base: CycleResult = {
    status: "ok",
    subscriptions: devices.length,
    areas: devices.reduce((sum, item) => sum + item.areas.length, 0),
    candidates: 0,
    sent: 0,
    quiet: 0,
    expired: 0,
    failed: 0,
  };
  if (!devices.length) {
    base.status = "idle";
    remember(base);
    return base;
  }

  await retryFailed(devices.map((item) => item.device), base);
  const active = listDevices();
  if (!active.length) {
    remember(base);
    return base;
  }

  const candidates = await loadCandidates(now);
  base.candidates = candidates.length;
  for (const { device, areas } of active) {
    if (!areas.length) continue;
    const hits = matchAreas(areas.map((area) => toTarget(area, device)), candidates, LOCATE);
    for (const hit of hits) {
      const copy = alertCopy(hit.candidate, device.timeZone);
      const url = alertLink(hit.candidate, hit.area);
      const claimed = claimEvent({
        subscriptionId: device.id,
        areaId: hit.area.id,
        stormKey: hit.candidate.stormKey,
        kind: hit.candidate.kind,
        title: copy.title,
        body: copy.body,
        place: hit.candidate.place,
        sizeIn: hit.candidate.sizeKnown ? hit.candidate.sizeIn : hit.candidate.sizeIn,
        occurredAt: hit.candidate.occurredAt,
        lat: hit.candidate.lat,
        lon: hit.candidate.lon,
        url,
      });
      if (!claimed) continue;
      const outcome = await pushToDevice(device, copy.title, copy.body, url, hit.candidate.stormKey);
      markEvent(claimed.id, outcome === "quiet" ? "quiet" : outcome);
      tally(base, outcome);
      if (outcome === "expired") break;
    }
  }
  remember(base);
  return base;
}

async function retryFailed(devices: PushDevice[], base: CycleResult) {
  const byId = new Map(devices.map((device) => [device.id, device]));
  for (const event of listRetryEvents()) {
    const device = byId.get(event.subscriptionId);
    if (!device) continue;
    const outcome = await pushToDevice(device, event.title, event.body, event.url, event.stormKey);
    markEvent(event.id, outcome === "quiet" ? "quiet" : outcome);
    tally(base, outcome);
    if (outcome === "expired") byId.delete(device.id);
  }
}

function tally(base: CycleResult, outcome: "sent" | "expired" | "failed" | "quiet") {
  if (outcome === "sent") base.sent += 1;
  else if (outcome === "quiet") base.quiet += 1;
  else if (outcome === "expired") base.expired += 1;
  else base.failed += 1;
}

function remember(result: CycleResult) {
  setMeta("alertsLastRun", new Date().toISOString());
  setMeta("alertsLastStatus", result.status);
  setMeta("alertsLastSent", String(result.sent));
  setMeta("alertsLastError", "");
  setMeta("alertsLastCandidates", String(result.candidates));
}

export function rememberAlertError(error: unknown) {
  setMeta("alertsLastRun", new Date().toISOString());
  setMeta("alertsLastStatus", "error");
  setMeta("alertsLastError", error instanceof Error ? error.message : "Alert check failed");
}

export function alertHealth() {
  const keys = getVapid();
  const counts = alertCounts();
  return {
    ok: true,
    vapid: keys.source,
    publicKey: keys.publicKey,
    subscriptions: counts.subscriptions,
    areas: counts.areas,
    pending: counts.pending,
    lastRunAt: getMeta("alertsLastRun"),
    lastRunStatus: getMeta("alertsLastStatus"),
    lastSent: Number(getMeta("alertsLastSent") ?? 0),
    lastCandidates: Number(getMeta("alertsLastCandidates") ?? 0),
    lastError: getMeta("alertsLastError") || null,
    intervalSec: alertIntervalSec(),
  };
}

export function alertIntervalSec(): number {
  return Math.round(alertIntervalMs() / 1000);
}

export function alertIntervalMs(): number {
  const raw = Number(process.env.HAILMAP_ALERT_INTERVAL_MS ?? 180_000);
  if (!Number.isFinite(raw)) return 180_000;
  return Math.min(300_000, Math.max(120_000, raw));
}
