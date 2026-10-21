/**
 * Discrete hail-size bands. Fills are these exact colors, not a blend.
 * The outer swath still starts at 0.75 in and reads as under an inch.
 */
export const MESH_LEGEND = [
  { minIn: 0.75, label: '<1"', mapLabel: "<1", color: "#16a34a", ink: "#ffffff" },
  { minIn: 1, label: '1"', mapLabel: "1", color: "#facc15", ink: "#ffffff" },
  { minIn: 1.5, label: '1.5"', mapLabel: "1.5", color: "#f97316", ink: "#ffffff" },
  { minIn: 2, label: '2"', mapLabel: "2", color: "#e11d48", ink: "#ffffff" },
  { minIn: 2.5, label: '2.5"+', mapLabel: "2.5+", color: "#d946ef", ink: "#ffffff" },
] as const;

export type MeshBand = (typeof MESH_LEGEND)[number];

export const MESH_SOURCE_NAME = "NOAA MRMS MESH";

/** Cells below this are kept out of the cache. Swaths still start at 0.75 in. */
export const MESH_SAMPLE_FLOOR_IN = 0.5;

export const MESH_WEST = -130;
export const MESH_SOUTH = 20;
export const MESH_EAST = -60;
export const MESH_NORTH = 55;
export const MESH_STEP = 0.02;
