import fs from "node:fs";
import path from "node:path";
import type { Feature } from "geojson";
import { dataDir } from "@/lib/db";
import { userAgent } from "@/lib/ingest";

const TILE = 256;

function worldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function worldY(lat: number, zoom: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

function chooseZoom(west: number, south: number, east: number, north: number, width: number, height: number): number {
  for (let zoom = 13; zoom >= 5; zoom -= 1) {
    const dx = Math.abs(worldX(east, zoom) - worldX(west, zoom)) * TILE;
    const dy = Math.abs(worldY(south, zoom) - worldY(north, zoom)) * TILE;
    if (dx <= width * 0.78 && dy <= height * 0.72) return zoom;
  }
  return 5;
}

async function tilePng(zoom: number, x: number, y: number): Promise<Buffer | null> {
  const safeX = ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
  const file = path.join(dataDir(), "tiles", String(zoom), String(safeX), `${y}.png`);
  if (fs.existsSync(file)) {
    try {
      return fs.readFileSync(file);
    } catch {
      /* refetch */
    }
  }
  const url = `https://basemaps.cartocdn.com/light_all/${zoom}/${safeX}/${y}.png`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "image/png" },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 32) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return bytes;
  } catch (error) {
    console.error("[hailmap] tile", error instanceof Error ? error.message : error);
    return null;
  }
}

function ringsOf(feature: Feature): number[][][] {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function pathOf(ring: number[][], project: (lon: number, lat: number) => { x: number; y: number }): string {
  return ring
    .map((pair, index) => {
      const point = project(Number(pair[0]), Number(pair[1]));
      return `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * A print-ready map: light basemap tiles, radar swaths, report dots, and the address.
 * Tiles are embedded so the page still prints if the browser is offline.
 */
export async function renderReportSnapshot(input: {
  lat: number;
  lon: number;
  reports: Array<{ lon: number; lat: number; hazard: string }>;
  swaths: Feature[];
}): Promise<string | null> {
  const width = 920;
  const height = 460;
  let west = input.lon - 0.18;
  let east = input.lon + 0.18;
  let south = input.lat - 0.12;
  let north = input.lat + 0.12;
  for (const report of input.reports) {
    if (Math.abs(report.lon - input.lon) > 0.7 || Math.abs(report.lat - input.lat) > 0.5) continue;
    west = Math.min(west, report.lon);
    east = Math.max(east, report.lon);
    south = Math.min(south, report.lat);
    north = Math.max(north, report.lat);
  }
  for (const feature of input.swaths) {
    for (const ring of ringsOf(feature)) {
      for (const pair of ring) {
        const lon = Number(pair[0]);
        const lat = Number(pair[1]);
        if (Math.abs(lon - input.lon) > 0.8 || Math.abs(lat - input.lat) > 0.6) continue;
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
  }
  const lonSpan = Math.max(0.08, east - west);
  const latSpan = Math.max(0.06, north - south);
  west -= lonSpan * 0.18;
  east += lonSpan * 0.18;
  south -= latSpan * 0.18;
  north += latSpan * 0.18;

  const zoom = chooseZoom(west, south, east, north, width, height);
  const x0 = Math.floor(worldX(west, zoom));
  const x1 = Math.floor(worldX(east, zoom));
  const yNorth = Math.floor(worldY(north, zoom));
  const ySouth = Math.floor(worldY(south, zoom));
  const tileX0 = Math.min(x0, x1);
  const tileX1 = Math.max(x0, x1);
  const tileY0 = Math.min(yNorth, ySouth);
  const tileY1 = Math.max(yNorth, ySouth);
  if (tileX1 - tileX0 > 4 || tileY1 - tileY0 > 3) return null;

  const tiles: Array<{ x: number; y: number; href: string }> = [];
  for (let x = tileX0; x <= tileX1; x += 1) {
    for (let y = tileY0; y <= tileY1; y += 1) {
      const png = await tilePng(zoom, x, y);
      if (!png) continue;
      tiles.push({ x, y, href: `data:image/png;base64,${png.toString("base64")}` });
    }
  }
  if (!tiles.length) return null;

  const originX = tileX0;
  const originY = tileY0;
  const project = (lon: number, lat: number) => ({
    x: (worldX(lon, zoom) - originX) * TILE,
    y: (worldY(lat, zoom) - originY) * TILE,
  });
  const viewLeft = (worldX(west, zoom) - originX) * TILE;
  const viewTop = (worldY(north, zoom) - originY) * TILE;
  const viewWidth = (worldX(east, zoom) - worldX(west, zoom)) * TILE;
  const viewHeight = (worldY(south, zoom) - worldY(north, zoom)) * TILE;

  const images = tiles
    .map((tile) => {
      const x = (tile.x - originX) * TILE;
      const y = (tile.y - originY) * TILE;
      return `<image href="${tile.href}" x="${x}" y="${y}" width="${TILE}" height="${TILE}"/>`;
    })
    .join("");

  const swaths = input.swaths
    .map((feature) => {
      const color = String(feature.properties?.color ?? "#ea580c");
      const paths = ringsOf(feature)
        .map((ring) => pathOf(ring, project))
        .join(" ");
      if (!paths) return "";
      return `<path d="${paths}" fill="${color}" fill-opacity="0.45" stroke="${color}" stroke-width="2"/>`;
    })
    .join("");

  const dots = input.reports
    .slice(0, 80)
    .map((report) => {
      const point = project(report.lon, report.lat);
      const color = report.hazard === "wind" ? "#1d4ed8" : report.hazard === "tornado" ? "#e11d48" : "#9a3412";
      return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.4"/>`;
    })
    .join("");

  const center = project(input.lon, input.lat);
  const marker = `<circle cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" r="9" fill="none" stroke="#083844" stroke-width="3"/>
    <path d="M ${center.x - 12} ${center.y} H ${center.x + 12} M ${center.x} ${center.y - 12} V ${center.y + 12}" stroke="#083844" stroke-width="1.6"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewLeft.toFixed(1)} ${viewTop.toFixed(1)} ${Math.max(viewWidth, 1).toFixed(1)} ${Math.max(viewHeight, 1).toFixed(1)}" role="img" aria-label="Map snapshot">
    <clipPath id="snap"><rect x="${viewLeft.toFixed(1)}" y="${viewTop.toFixed(1)}" width="${Math.max(viewWidth, 1).toFixed(1)}" height="${Math.max(viewHeight, 1).toFixed(1)}"/></clipPath>
    <g clip-path="url(#snap)">
      <rect x="${viewLeft.toFixed(1)}" y="${viewTop.toFixed(1)}" width="${Math.max(viewWidth, 1).toFixed(1)}" height="${Math.max(viewHeight, 1).toFixed(1)}" fill="#e7eef5"/>
      ${images}
      ${swaths}
      ${dots}
      ${marker}
    </g>
    <rect x="${(viewLeft + 10).toFixed(1)}" y="${(viewTop + 10).toFixed(1)}" width="250" height="22" rx="11" fill="#ffffff" fill-opacity="0.92"/>
    <text x="${(viewLeft + 22).toFixed(1)}" y="${(viewTop + 25).toFixed(1)}" fill="#5c6d82" font-family="Inter, Segoe UI, sans-serif" font-size="11">© OpenStreetMap © CARTO · MRMS MESH</text>
  </svg>`;
}
