import { inflateSync, gunzipSync } from "node:zlib";
import {
  MESH_EAST,
  MESH_NORTH,
  MESH_SAMPLE_FLOOR_IN,
  MESH_SOUTH,
  MESH_STEP,
  MESH_WEST,
} from "@/lib/mesh-legend";
import type { MeshCell, MeshGridShape } from "@/lib/mesh-contour";

export interface DecodedMesh {
  validTime: string;
  productHint: string;
  shape: MeshGridShape;
  cells: MeshCell[];
}

function readSigned(buffer: Buffer, offset: number, bytes: number): number {
  if (bytes === 2) return buffer.readInt16BE(offset);
  if (bytes === 4) return buffer.readInt32BE(offset);
  const value = buffer.readUIntBE(offset, bytes);
  const sign = 1 << (bytes * 8 - 1);
  return value & sign ? value - sign * 2 : value;
}

function wrapLon(lon: number): number {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

export function meshInches(raw: number, reference: number, binaryScale: number, decimalScale: number): number {
  const millimeters = (reference + raw * 2 ** binaryScale) * 10 ** -decimalScale;
  return millimeters / 25.4;
}

export function gunzipIfNeeded(buffer: Buffer): Buffer {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return gunzipSync(buffer);
  return buffer;
}

function chunkText(buffer: Buffer, offset: number, length: number): Buffer {
  return buffer.subarray(offset, offset + length);
}

/** Decode an 8-bit or 16-bit grayscale PNG. Calls onRow with a buffer that is reused. */
export function decodePngGray(png: Buffer, onRow: (y: number, samples: Uint16Array, width: number) => void): { width: number; height: number } {
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("MESH data is not a PNG");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = chunkText(png, offset + 8, length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if ((bitDepth !== 16 && bitDepth !== 8) || colorType !== 0) {
    throw new Error(`Unexpected MESH PNG (${bitDepth}-bit color ${colorType})`);
  }
  if (width < 2 || height < 2 || width > 20000 || height > 20000) throw new Error("Unexpected MESH grid size");

  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = bitDepth === 16 ? 2 : 1;
  const rowBytes = width * bytesPerPixel;
  if (raw.length < height * (rowBytes + 1)) throw new Error("MESH PNG is shorter than its grid");
  const row = new Uint8Array(rowBytes);
  const previous = new Uint8Array(rowBytes);
  const samples = new Uint16Array(width);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    row.set(raw.subarray(cursor, cursor + rowBytes));
    cursor += rowBytes;
    if (filter === 1) {
      for (let i = 0; i < rowBytes; i += 1) row[i] = (row[i] + (i >= bytesPerPixel ? row[i - bytesPerPixel] : 0)) & 255;
    } else if (filter === 2) {
      for (let i = 0; i < rowBytes; i += 1) row[i] = (row[i] + previous[i]) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < rowBytes; i += 1) {
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
        row[i] = (row[i] + ((left + previous[i]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < rowBytes; i += 1) {
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
        const up = previous[i];
        const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[i] = (row[i] + predictor) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter ${filter}`);
    }
    previous.set(row);
    if (bitDepth === 16) {
      for (let x = 0; x < width; x += 1) samples[x] = (row[x * 2] << 8) | row[x * 2 + 1];
    } else {
      for (let x = 0; x < width; x += 1) samples[x] = row[x];
    }
    onRow(y, samples, width);
  }
  return { width, height };
}

function angleUnit(basic: number, subdivisions: number): number {
  if (!basic || !subdivisions) return 1e-6;
  return basic / subdivisions;
}

/**
 * Read one NOAA MRMS MESH GRIB2 message.
 * Operational files pack the grid as a 16-bit PNG (template 5.41) on a lat/lon grid.
 */
export function readGribMesh(buffer: Buffer): DecodedMesh {
  if (buffer.subarray(0, 4).toString("ascii") !== "GRIB" || buffer[7] !== 2) {
    throw new Error("Not a GRIB2 MESH file");
  }
  let offset = 16;
  const sections = new Map<number, Buffer>();
  while (offset + 4 < buffer.length) {
    if (buffer.subarray(offset, offset + 4).toString("ascii") === "7777") break;
    const length = buffer.readUInt32BE(offset);
    if (length < 5 || offset + length > buffer.length) throw new Error("Truncated GRIB2 section");
    const number = buffer[offset + 4];
    sections.set(number, buffer.subarray(offset, offset + length));
    offset += length;
  }

  const section1 = sections.get(1);
  const section3 = sections.get(3);
  const section5 = sections.get(5);
  const section7 = sections.get(7);
  if (!section1 || !section3 || !section5 || !section7) throw new Error("MESH GRIB2 is missing a grid section");

  const year = section1.readUInt16BE(12);
  const month = section1[14];
  const day = section1[15];
  const hour = section1[16];
  const minute = section1[17];
  const second = section1[18];
  const validTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();

  const template = section3.readUInt16BE(12);
  if (template !== 0) throw new Error(`Unsupported MESH grid template ${template}`);
  const grid = section3.subarray(14);
  const ni = grid.readUInt32BE(16);
  const nj = grid.readUInt32BE(20);
  const unit = angleUnit(grid.readUInt32BE(24), grid.readUInt32BE(28));
  const lat1 = readSigned(grid, 32, 4) * unit;
  const lon1 = readSigned(grid, 36, 4) * unit;
  const lat2 = readSigned(grid, 41, 4) * unit;
  const lon2 = readSigned(grid, 45, 4) * unit;

  const representation = section5.readUInt16BE(9);
  if (representation !== 41) throw new Error(`MESH packing ${representation} is not PNG`);
  const reference = section5.readFloatBE(11);
  const binaryScale = section5.readInt16BE(15);
  const decimalScale = section5.readInt16BE(17);

  const shape: MeshGridShape = {
    west: MESH_WEST,
    south: MESH_SOUTH,
    step: MESH_STEP,
    nx: Math.round((MESH_EAST - MESH_WEST) / MESH_STEP),
    ny: Math.round((MESH_NORTH - MESH_SOUTH) / MESH_STEP),
  };
  const bins = new Float32Array(shape.nx * shape.ny);
  const millimeters = MESH_SAMPLE_FLOOR_IN * 25.4;
  const minRaw = Math.ceil((millimeters / 10 ** -decimalScale - reference) / 2 ** binaryScale);

  const latSpan = nj > 1 ? (lat2 - lat1) / (nj - 1) : 0;
  const lonSpan = ni > 1 ? (lon2 - lon1) / (ni - 1) : 0;

  decodePngGray(section7.subarray(5), (y, samples, width) => {
    const lat = lat1 + latSpan * y;
    if (lat < shape.south || lat >= shape.south + shape.ny * shape.step) return;
    const iy = Math.min(shape.ny - 1, Math.max(0, Math.floor((lat - shape.south) / shape.step)));
    const row = iy * shape.nx;
    for (let x = 0; x < width; x += 1) {
      const raw = samples[x];
      if (raw < minRaw) continue;
      const lon = wrapLon(lon1 + lonSpan * x);
      if (lon < shape.west || lon >= shape.west + shape.nx * shape.step) continue;
      const ix = Math.min(shape.nx - 1, Math.max(0, Math.floor((lon - shape.west) / shape.step)));
      const inches = Math.round(meshInches(raw, reference, binaryScale, decimalScale) * 100) / 100;
      const index = row + ix;
      if (inches > bins[index]) bins[index] = inches;
    }
  });

  const cells: MeshCell[] = [];
  for (let i = 0; i < bins.length; i += 1) {
    if (bins[i] < MESH_SAMPLE_FLOOR_IN) continue;
    cells.push({ ix: i % shape.nx, iy: Math.floor(i / shape.nx), inches: bins[i] });
  }
  return {
    validTime,
    productHint: ni === 7000 && nj === 3500 ? "MRMS CONUS" : "MRMS",
    shape,
    cells,
  };
}
