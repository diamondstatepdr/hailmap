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
  /** Stored filename under HAILMAP_DATA_DIR/photos, when this report has a photo. */
  photoId?: string | null;
  /** Public path for the photo, when one was stored. */
  photoUrl?: string | null;
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
  photoId?: string | null;
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
