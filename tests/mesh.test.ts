import { deflateSync, crc32 } from "node:zlib";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cellsToSwaths, DEFAULT_MESH_SHAPE, sampleIndexed, indexCells, type MeshCell } from "@/lib/mesh-contour";
import { gunzipIfNeeded, meshInches, readGribMesh } from "@/lib/grib-mesh";
import { dayFetchUrls, planMesh } from "@/lib/mesh-plan";
import { buildStormReport } from "@/lib/storm-report";
import type { PlaceHistory } from "@/lib/place";

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function grayPng(width: number, height: number, values: number[][]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 2));
  for (let y = 0; y < height; y += 1) {
    const start = y * (1 + width * 2);
    raw[start] = 0;
    for (let x = 0; x < width; x += 1) {
      raw.writeUInt16BE(values[y][x], start + 1 + x * 2);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function gribSection(number: number, body: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(5 + body.length);
  head[4] = number;
  return Buffer.concat([head, body]);
}

function sampleGrib(): Buffer {
  const section1 = Buffer.alloc(16);
  section1.writeUInt16BE(2024, 7);
  section1[9] = 5;
  section1[10] = 21;
  section1[11] = 18;
  const template = Buffer.alloc(58);
  template.writeUInt32BE(4, 16);
  template.writeUInt32BE(3, 20);
  template.writeUInt32BE(1, 24);
  template.writeUInt32BE(1_000_000, 28);
  template.writeInt32BE(40_000_000, 32);
  template.writeInt32BE(-100_000_000, 36);
  template.writeInt32BE(39_980_000, 41);
  template.writeInt32BE(-99_970_000, 45);
  const section3 = Buffer.alloc(9 + template.length);
  section3.writeUInt32BE(12, 1);
  section3.writeUInt16BE(0, 7);
  template.copy(section3, 9);
  const section5 = Buffer.alloc(16);
  section5.writeUInt32BE(12, 0);
  section5.writeUInt16BE(41, 4);
  section5.writeFloatBE(-30, 6);
  section5.writeInt16BE(0, 10);
  section5.writeInt16BE(1, 12);
  section5[14] = 16;
  const values = [
    [0, 0, 0, 0],
    [0, 284, 0, 0],
    [0, 0, 0, 0],
  ];
  const parts = [
    gribSection(1, section1),
    gribSection(3, section3),
    gribSection(5, section5),
    gribSection(7, grayPng(4, 3, values)),
  ];
  const message = Buffer.concat([Buffer.alloc(16), ...parts, Buffer.from("7777")]);
  message.write("GRIB", 0, "ascii");
  message[6] = 0;
  message[7] = 2;
  message.writeBigUInt64BE(BigInt(message.length), 8);
  return message;
}

describe("MRMS MESH plan", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  it("uses the last hour of MESH for live and 6-hour windows", () => {
    expect(planMesh({ hours: 0.75, now })).toMatchObject({ mode: "latest-60", product: "MESH_Max_60min" });
    const six = planMesh({ hours: 6, now });
    expect(six).toMatchObject({ mode: "latest-60" });
    if ("note" in six) expect(six.note).toMatch(/no 6-hour/i);
  });

  it("uses the rolling 24-hour product for today and a past file for an older date", () => {
    expect(planMesh({ hours: 24, now })).toMatchObject({ mode: "latest-1440", label: "Last 24 hours" });
    expect(planMesh({ date: "2026-10-19", now })).toMatchObject({ mode: "latest-1440" });
    const past = planMesh({ date: "2024-05-21", now });
    expect(past).toMatchObject({ mode: "days", dates: ["2024-05-21"] });
    if ("dates" in past) {
      expect(dayFetchUrls(past.dates[0], now)[0]).toContain("mtarchive.geol.iastate.edu/2024/05/22/mrms/ncep/MESH_Max_1440min/");
    }
  });

  it("rejects a future date", () => {
    expect(planMesh({ date: "2027-01-01", now })).toEqual({ error: "That radar date is in the future." });
  });
});

describe("MESH contours", () => {
  const shape = { west: -100, south: 40, step: 0.02, nx: 6, ny: 6 };

  it("draws a 1 inch swath and keeps a 2 inch core inside it", () => {
    const cells: MeshCell[] = [
      { ix: 1, iy: 1, inches: 1.1 },
      { ix: 2, iy: 1, inches: 2.4 },
      { ix: 1, iy: 2, inches: 1.2 },
      { ix: 2, iy: 2, inches: 1.6 },
    ];
    const collection = cellsToSwaths(cells, shape, {
      product: "MESH_Max_1440min",
      validTime: "2026-10-19T12:00:00.000Z",
      label: "Last 24 hours",
    });
    const bands = collection.features.map((feature) => feature.properties?.minIn);
    expect(bands).toContain(0.75);
    expect(bands).toContain(1);
    expect(bands).toContain(1.5);
    expect(bands).toContain(2);
    const severe = collection.features.find((feature) => feature.properties?.minIn === 2);
    expect(severe?.properties?.maxIn).toBe(2.4);
    const ring = severe?.geometry.type === "Polygon" ? severe.geometry.coordinates[0] : [];
    expect(ring.length).toBeGreaterThan(5);
    const indexed = indexCells(cells, shape);
    expect(sampleIndexed(indexed, shape, 40.03, -99.97)).toBe(2.4);
    expect(sampleIndexed(indexed, shape, 41, -90)).toBeNull();
  });

  it("uses the default CONUS bin for an empty sample", () => {
    expect(sampleIndexed(new Map(), DEFAULT_MESH_SHAPE, 35, -97)).toBeNull();
  });
});

describe("GRIB2 MESH decode", () => {
  it("converts scaled millimeters to inches", () => {
    expect(meshInches(284, -30, 0, 1)).toBeCloseTo(1, 2);
  });

  it("reads a PNG-packed lat/lon grid", () => {
    const decoded = readGribMesh(sampleGrib());
    expect(decoded.validTime).toBe("2024-05-21T18:00:00.000Z");
    expect(decoded.cells).toHaveLength(1);
    expect(decoded.cells[0].inches).toBe(1);
    const indexed = indexCells(decoded.cells, decoded.shape);
    expect(sampleIndexed(indexed, decoded.shape, 39.99, -99.99)).toBe(1);
  });

  it("decodes a live NOAA MESH file when one is cached locally", () => {
    const file = "/tmp/mesh/latest.grib2";
    if (!fs.existsSync(file)) return;
    const decoded = readGribMesh(gunzipIfNeeded(fs.readFileSync(file)));
    expect(decoded.cells.length).toBeGreaterThan(0);
    const peak = Math.max(...decoded.cells.map((cell) => cell.inches));
    expect(peak).toBeGreaterThan(0.75);
    expect(peak).toBeLessThan(6);
  });
});

describe("address report radar fields", () => {
  it("keeps radar size, warnings, and the snapshot on the document", () => {
    const history = {
      lat: 35.2,
      lon: -97.4,
      radiusKm: 15,
      hours: 24,
      reports: [],
      maxHailIn: 1,
      maxWindMph: null,
      strongestTornado: null,
      nearestKm: 4,
      swathHit: false,
      swathMaxSizeIn: null,
      warnings: [],
      warningStatus: "ok",
      score: { score: 10, level: "Low", factors: [], summary: "Low" },
    } satisfies PlaceHistory;
    const document = buildStormReport({
      title: "123 Main St",
      kind: "address",
      label: "123 Main St",
      lat: 35.2,
      lon: -97.4,
      radiusKm: 15,
      bounds: null,
      hours: 24,
      history,
      listed: [],
      radar: {
        maxIn: 1.25,
        note: "Rolling NOAA MRMS MESH maximum.",
        days: [
          {
            date: null,
            label: "Last 24 hours",
            maxIn: 1.25,
            validTime: "2026-10-19T12:00:00Z",
            product: "MESH_Max_1440min",
            status: "ok",
          },
        ],
      },
      nearbyWarnings: [
        {
          id: "sv",
          event: "Severe Thunderstorm Warning",
          kind: "warning",
          issued: "2026-10-19T01:00:00Z",
          until: "2026-10-19T02:00:00Z",
          office: "OUN",
          area: "OKC027",
        },
      ],
      snapshotSvg: "<svg></svg>",
    });
    expect(document.meshMaxIn).toBe(1.25);
    expect(document.meshDays[0].label).toBe("Last 24 hours");
    expect(document.nearbyWarnings[0].event).toBe("Severe Thunderstorm Warning");
    expect(document.snapshotSvg).toContain("<svg");
    expect(document.sources.some((source) => source.includes("Radar hail"))).toBe(true);
  });
});
