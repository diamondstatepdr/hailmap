import type { Confidence } from "@/lib/confidence";

export interface HailReport {
  id: string;
  source: string;
  confidence: Confidence;
  lat: number;
  lon: number;
  sizeIn: number | null;
  sizeRaw: string | null;
  occurredAt: string;
  location: string | null;
  county: string | null;
  state: string | null;
  remark: string | null;
  damageTags: string[];
}

export interface IncomingReport {
  source: string;
  externalId: string;
  confidence: Confidence;
  lat: number;
  lon: number;
  sizeIn: number | null;
  sizeRaw: string | null;
  occurredAt: string;
  location: string | null;
  county: string | null;
  state: string | null;
  remark: string | null;
}

export type FeedStatus = "ok" | "error" | "empty" | "skipped";

export interface SourceStatus {
  spc: FeedStatus;
  iem: FeedStatus;
  nws: FeedStatus;
  mesh: FeedStatus;
}

export interface ReportsResponse {
  updatedAt: string;
  syncedAt: string | null;
  sourceStatus: SourceStatus | null;
  rawCount: number;
  reports: HailReport[];
}
