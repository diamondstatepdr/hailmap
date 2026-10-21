import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { dataDir } from "@/lib/db";
import { streetFrame, type HailProof } from "@/lib/hail-proof";
import { userAgent } from "@/lib/ingest";

const TILE = 256;

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dp = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dp) return left;
  if (du <= dp) return up;
  return upLeft;
}

/** Decode an 8-bit PNG (gray, RGB, indexed, or alpha) into straight RGBA. */
export function decodePng(buf: Buffer): RgbaImage | null {
  if (buf.length < 8 || buf[0] !== 137 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > buf.length) return null;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!width || !height || bitDepth !== 8 || !idat.length) return null;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 || colorType === 3 ? 1 : 0;
  if (!channels) return null;
  if (colorType === 3 && !palette) return null;
  const stride = width * channels;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < height * (stride + 1)) return null;
  const scan = new Uint8Array(height * stride);
  let cursor = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = scan.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i] ?? 0;
      const upLeft = i >= channels ? previous[i - channels] ?? 0 : 0;
      const value = raw[cursor + i] ?? 0;
      if (filter === 1) row[i] = (value + left) & 255;
      else if (filter === 2) row[i] = (value + up) & 255;
      else if (filter === 3) row[i] = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) row[i] = (value + paeth(left, up, upLeft)) & 255;
      else row[i] = value;
    }
    cursor += stride;
    previous = row;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;
    if (colorType === 2) {
      r = scan[source];
      g = scan[source + 1];
      b = scan[source + 2];
    } else if (colorType === 6) {
      r = scan[source];
      g = scan[source + 1];
      b = scan[source + 2];
      a = scan[source + 3];
    } else if (colorType === 0) {
      r = g = b = scan[source];
    } else if (colorType === 4) {
      r = g = b = scan[source];
      a = scan[source + 1];
    } else if (palette) {
      const index = scan[source] * 3;
      r = palette[index] ?? 0;
      g = palette[index + 1] ?? 0;
      b = palette[index + 2] ?? 0;
      if (transparency && scan[source] < transparency.length) a = transparency[scan[source]];
    }
    const dest = i * 4;
    rgba[dest] = r;
    rgba[dest + 1] = g;
    rgba[dest + 2] = b;
    rgba[dest + 3] = a;
  }
  return { width, height, rgba };
}

function worldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function worldY(lat: number, zoom: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

function chooseZoom(frame: { west: number; east: number; south: number; north: number }): number {
  for (let zoom = 16; zoom >= 13; zoom -= 1) {
    const dx = Math.abs(Math.floor(worldX(frame.east, zoom)) - Math.floor(worldX(frame.west, zoom)));
    const dy = Math.abs(Math.floor(worldY(frame.south, zoom)) - Math.floor(worldY(frame.north, zoom)));
    if (dx <= 3 && dy <= 3) return zoom;
  }
  return 13;
}

async function tilePng(zoom: number, x: number, y: number): Promise<Buffer | null> {
  const safeX = ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;
  const file = path.join(dataDir(), "tiles", "osm", String(zoom), String(safeX), `${y}.png`);
  if (fs.existsSync(file)) {
    try {
      return fs.readFileSync(file);
    } catch {
      /* refetch */
    }
  }
  try {
    const response = await fetch(`https://tile.openstreetmap.org/${zoom}/${safeX}/${y}.png`, {
      headers: { "User-Agent": userAgent(), Accept: "image/png" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 32) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return bytes;
  } catch (error) {
    console.error("[hailmap] proof tile", error instanceof Error ? error.message : error);
    return null;
  }
}

interface PlacedTile {
  x: number;
  y: number;
  png: Buffer;
  rgba: RgbaImage;
}

async function loadTiles(proof: HailProof): Promise<{
  zoom: number;
  frame: ReturnType<typeof streetFrame>;
  originX: number;
  originY: number;
  tiles: PlacedTile[];
} | null> {
  const frame = streetFrame(proof.lat, proof.lon);
  const zoom = chooseZoom(frame);
  const tileX0 = Math.min(Math.floor(worldX(frame.west, zoom)), Math.floor(worldX(frame.east, zoom)));
  const tileX1 = Math.max(Math.floor(worldX(frame.west, zoom)), Math.floor(worldX(frame.east, zoom)));
  const tileY0 = Math.min(Math.floor(worldY(frame.north, zoom)), Math.floor(worldY(frame.south, zoom)));
  const tileY1 = Math.max(Math.floor(worldY(frame.north, zoom)), Math.floor(worldY(frame.south, zoom)));
  const tiles: PlacedTile[] = [];
  let misses = 0;
  for (let x = tileX0; x <= tileX1 && misses < 2; x += 1) {
    for (let y = tileY0; y <= tileY1 && misses < 2; y += 1) {
      const png = await tilePng(zoom, x, y);
      if (!png) {
        misses += 1;
        continue;
      }
      const rgba = decodePng(png);
      if (!rgba) continue;
      tiles.push({ x, y, png, rgba });
    }
  }
  if (!tiles.length) return null;
  return { zoom, frame, originX: tileX0, originY: tileY0, tiles };
}

function project(input: {
  zoom: number;
  originX: number;
  originY: number;
  lon: number;
  lat: number;
}): { x: number; y: number } {
  return {
    x: (worldX(input.lon, input.zoom) - input.originX) * TILE,
    y: (worldY(input.lat, input.zoom) - input.originY) * TILE,
  };
}

function ringPath(
  ring: number[][],
  placed: NonNullable<Awaited<ReturnType<typeof loadTiles>>>,
): string {
  return ring
    .map(([lon, lat], index) => {
      const point = project({ ...placed, lon, lat });
      return `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    })
    .join(" ");
}

/** Street-level OSM tiles with the hail bands drawn on top. Falls back to the vector swath. */
export async function proofStreetSvg(proof: HailProof, fallback: string): Promise<string> {
  const placed = await loadTiles(proof);
  if (!placed) return fallback;
  const { frame, zoom, originX, originY } = placed;
  const left = (worldX(frame.west, zoom) - originX) * TILE;
  const top = (worldY(frame.north, zoom) - originY) * TILE;
  const width = Math.max(1, (worldX(frame.east, zoom) - worldX(frame.west, zoom)) * TILE);
  const height = Math.max(1, (worldY(frame.south, zoom) - worldY(frame.north, zoom)) * TILE);
  const images = placed.tiles
    .map((tile) => {
      const x = (tile.x - originX) * TILE;
      const y = (tile.y - originY) * TILE;
      return `<image href="data:image/png;base64,${tile.png.toString("base64")}" x="${x}" y="${y}" width="${TILE}" height="${TILE}"/>`;
    })
    .join("");
  const bands = proof.rings
    .map((ring, index) => {
      const color = proof.colors[index] || "#f97316";
      const d = ringPath(ring, placed);
      if (!d) return "";
      return `<path d="${d} Z" fill="${color}" fill-opacity="0.4" stroke="#102033" stroke-width="2.5"/>`;
    })
    .join("");
  const pin = project({ zoom, originX, originY, lon: proof.lon, lat: proof.lat });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left.toFixed(1)} ${top.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}" role="img" aria-label="Street map with hail swath">
    <clipPath id="proof-street"><rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}"/></clipPath>
    <g clip-path="url(#proof-street)">
      <rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="#e7eef5"/>
      ${images}
      ${bands}
      <circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="8" fill="#0b1f6e" stroke="#ffffff" stroke-width="2"/>
    </g>
  </svg>`;
}

/** The same street frame as RGB pixels, for the PDF image. */
export async function proofStreetRaster(proof: HailProof): Promise<{ width: number; height: number; rgb: Buffer } | null> {
  const placed = await loadTiles(proof);
  if (!placed) return null;
  const { frame, zoom, originX, originY } = placed;
  const left = (worldX(frame.west, zoom) - originX) * TILE;
  const top = (worldY(frame.north, zoom) - originY) * TILE;
  const width = Math.max(1, Math.round((worldX(frame.east, zoom) - worldX(frame.west, zoom)) * TILE));
  const height = Math.max(1, Math.round((worldY(frame.south, zoom) - worldY(frame.north, zoom)) * TILE));
  const rgb = Buffer.alloc(width * height * 3, 231);
  for (const tile of placed.tiles) {
    const destX = Math.round((tile.x - originX) * TILE - left);
    const destY = Math.round((tile.y - originY) * TILE - top);
    const { rgba, width: srcW, height: srcH } = tile.rgba;
    for (let y = 0; y < srcH; y += 1) {
      const dy = destY + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < srcW; x += 1) {
        const dx = destX + x;
        if (dx < 0 || dx >= width) continue;
        const source = (y * srcW + x) * 4;
        const alpha = rgba[source + 3] / 255;
        const dest = (dy * width + dx) * 3;
        rgb[dest] = Math.round(rgba[source] * alpha + rgb[dest] * (1 - alpha));
        rgb[dest + 1] = Math.round(rgba[source + 1] * alpha + rgb[dest + 1] * (1 - alpha));
        rgb[dest + 2] = Math.round(rgba[source + 2] * alpha + rgb[dest + 2] * (1 - alpha));
      }
    }
  }
  return { width, height, rgb };
}
