import { userAgent } from "@/lib/ingest";
import {
  assembleThreats,
  nwsThreatsUrl,
  SPC_DAY1_CATEGORICAL_URL,
  SPC_SIGNIFICANT_URLS,
  type SignificantProduct,
  type ThreatsResponse,
} from "@/lib/threats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 10 * 60 * 1000;

let cached: { at: number; body: ThreatsResponse } | null = null;
let inflight: Promise<ThreatsResponse> | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent(),
      Accept: "application/geo+json, application/json",
    },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function loadOne(url: string): Promise<unknown | null> {
  try {
    return await fetchJson(url);
  } catch (error) {
    console.error("[hailmap] threats", error instanceof Error ? error.message : error);
    return null;
  }
}

async function loadThreats(): Promise<ThreatsResponse> {
  const significantProducts = Object.keys(SPC_SIGNIFICANT_URLS) as SignificantProduct[];
  const [alerts, categorical, ...significantPayloads] = await Promise.all([
    loadOne(nwsThreatsUrl()),
    loadOne(SPC_DAY1_CATEGORICAL_URL),
    ...significantProducts.map((product) => loadOne(SPC_SIGNIFICANT_URLS[product])),
  ]);
  const assembled = assembleThreats({
    alerts,
    categorical,
    significant: significantProducts.map((product, index) => ({
      product,
      payload: significantPayloads[index] ?? null,
    })),
  });
  const body: ThreatsResponse = {
    updatedAt: new Date().toISOString(),
    syncedAt: new Date().toISOString(),
    status: assembled.status,
    collection: { type: "FeatureCollection", features: assembled.features },
  };
  if (assembled.status.nws === "error" && assembled.status.spc === "error") {
    return cached ? cached.body : body;
  }
  cached = { at: Date.now(), body };
  return body;
}

export async function GET() {
  try {
    if (cached && Date.now() - cached.at < TTL_MS) {
      return Response.json(cached.body, {
        headers: { "Cache-Control": "public, max-age=120" },
      });
    }
    if (!inflight) {
      inflight = loadThreats().finally(() => {
        inflight = null;
      });
    }
    const body = await inflight;
    return Response.json(body, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  } catch (error) {
    console.error("[hailmap] threats", error instanceof Error ? error.message : error);
    if (cached) {
      return Response.json(cached.body, {
        headers: { "Cache-Control": "public, max-age=60" },
      });
    }
    const empty: ThreatsResponse = {
      updatedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
      status: { nws: "error", spc: "error" },
      collection: { type: "FeatureCollection", features: [] },
    };
    return Response.json(empty);
  }
}
