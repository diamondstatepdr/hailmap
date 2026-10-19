/** Discrete MRMS MESH bands drawn on the map and printed on reports. */
export const MESH_LEGEND = [
  { minIn: 0.75, label: '0.75"', color: "#65a30d" },
  { minIn: 1, label: '1"', color: "#ca8a04" },
  { minIn: 1.5, label: '1.5"', color: "#ea580c" },
  { minIn: 2, label: '2"+', color: "#dc2626" },
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
