import { addIsoDays } from "@/lib/mesh-plan";

/** Coarse 0.1° cell row in SQLite, including index overhead. Used only for the size estimate. */
export const MESH_CELL_BYTES = 96;

/**
 * Stop the background walk before the coarse hail index grows without a bound.
 * A full raw GRIB cache is not stored. This cap is the indexed cells only.
 */
export const MESH_INDEX_BUDGET_BYTES = 320 * 1024 * 1024;

/**
 * High planning rate from one real 24-hour MESH file, not a multi-year mean.
 * Convective day 2024-05-09, file MESH_Max_1440min_00.50_20240510-120000.grib2.gz
 * (709,432 bytes gzip, valid 2024-05-10T12:00:00Z): 2,701 bins at 0.1° with hail of at least 0.5 in.
 * A quiet day, 2024-02-01 (file valid 2024-02-02T12:00:00Z, 79,458 bytes gzip), was 30 bins.
 * The walk stores the real count for each day and stops at the byte budget. Raw GRIB is not kept.
 */
export const MESH_PLANNING_CELLS_PER_DAY = 2701;

export function countIsoDays(start: string, end: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return 0;
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const span = Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay);
  return Math.round(span / 86_400_000) + 1;
}

export function estimateMeshIndex(input: {
  from: string;
  to: string;
  cellsPerDay?: number;
  budgetBytes?: number;
}): {
  from: string;
  to: string;
  days: number;
  cellsPerDay: number;
  bytes: number;
  budgetBytes: number;
  withinBudget: boolean;
} {
  const cellsPerDay = input.cellsPerDay ?? MESH_PLANNING_CELLS_PER_DAY;
  const budgetBytes = input.budgetBytes ?? MESH_INDEX_BUDGET_BYTES;
  const days = countIsoDays(input.from, input.to);
  const bytes = days * cellsPerDay * MESH_CELL_BYTES;
  return {
    from: input.from,
    to: input.to,
    days,
    cellsPerDay,
    bytes,
    budgetBytes,
    withinBudget: bytes <= budgetBytes,
  };
}

/** Whether the next day's cells still fit. Checked after decode and before the insert. */
export function meshStoreDecision(existingCells: number, incomingCells: number, budgetBytes = MESH_INDEX_BUDGET_BYTES): "store" | "stop" {
  const next = Math.max(0, existingCells) + Math.max(0, incomingCells);
  if (next * MESH_CELL_BYTES > budgetBytes) return "stop";
  return "store";
}

export function meshBudgetBytes(): number {
  const raw = Number(process.env.HAILMAP_MESH_BUDGET_BYTES);
  if (Number.isFinite(raw) && raw >= MESH_CELL_BYTES) return Math.floor(raw);
  return MESH_INDEX_BUDGET_BYTES;
}

export function yesterdayIso(now = new Date()): string {
  return addIsoDays(now.toISOString().slice(0, 10), -1);
}
