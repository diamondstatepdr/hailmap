import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { placeFromCensus } from "@/lib/geocode";
import {
  clientIp,
  detectImage,
  resolvePhoto,
  savePhoto,
  stripLocationMetadata,
  takePhotoSlot,
} from "@/lib/photos";
import { buildPhotoSubmission, toHailReport } from "@/lib/submit";
import { listRecentReports, upsertReports } from "@/lib/db";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-photo-"));
process.env.HAILMAP_DATA_DIR = dataDir;
process.env.HAILMAP_PHOTO_HOURLY_LIMIT = "2";
process.env.HAILMAP_PHOTO_DAILY_LIMIT = "4";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const PHOTO_ID = "11111111-1111-4111-8111-111111111111.jpg";

function jpegWithGps(): Buffer {
  const payload = Buffer.from("Exif\0\0GPSLatitude", "latin1");
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment, Buffer.from([0xff, 0xd9])]);
}

describe("photo hail reports", () => {
  it("stores a community photo report and serves a photo URL", () => {
    const parsed = buildPhotoSubmission({
      lat: "35.22",
      lon: "-97.44",
      sizeIn: "golf ball",
      remark: "hail on the driveway",
      photoId: PHOTO_ID,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.report.confidence).toBe("community");
    expect(parsed.report.source).toBe("photo");
    expect(parsed.report.sizeIn).toBe(1.75);
    expect(parsed.report.photoId).toBe(PHOTO_ID);

    const stored = savePhoto(jpegWithGps());
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const saved = buildPhotoSubmission({
      lat: 35.22,
      lon: -97.44,
      sizeIn: 1.25,
      photoId: stored.filename,
      remark: "quarter sized",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    upsertReports([saved.report]);
    const listed = listRecentReports(7).find((item) => item.id === `photo:${saved.report.externalId}`);
    expect(listed?.confidence).toBe("community");
    expect(listed?.photoUrl).toBe(`/api/photos/${stored.filename.replace(/\.jpg$/, "")}`);
    expect(toHailReport(saved.report).photoUrl).toBe(listed?.photoUrl);

    const file = resolvePhoto(stored.filename.replace(/\.jpg$/, ""));
    expect(file?.contentType).toBe("image/jpeg");
    const bytes = readFileSync(file!.absolute);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.includes(Buffer.from("GPSLatitude"))).toBe(false);
  });

  it("rejects a bad photo, a bad pin, and an old time", () => {
    expect(detectImage(Buffer.from("not-a-photo"))).toBeNull();
    expect(savePhoto(Buffer.from("not-a-photo")).ok).toBe(false);
    expect(resolvePhoto("../../etc/passwd")).toBeNull();
    expect(
      buildPhotoSubmission({ lat: 99, lon: 0, sizeIn: 1, photoId: PHOTO_ID }).ok,
    ).toBe(false);
    expect(
      buildPhotoSubmission({ lat: 35, lon: -97, sizeIn: "", photoId: PHOTO_ID }).ok,
    ).toBe(false);
    const old = buildPhotoSubmission({
      lat: 35,
      lon: -97,
      sizeIn: 1,
      photoId: PHOTO_ID,
      occurredAt: "2020-01-01T00:00:00.000Z",
    });
    expect(old.ok).toBe(false);
  });

  it("strips WebP EXIF and still keeps the image chunk", () => {
    const image = Buffer.concat([
      Buffer.from("VP8 "),
      Buffer.alloc(4),
      Buffer.from("data"),
    ]);
    image.writeUInt32LE(4, 4);
    const exif = Buffer.concat([Buffer.from("EXIF"), Buffer.alloc(4), Buffer.from("GPSLatitude")]);
    exif.writeUInt32LE("GPSLatitude".length, 4);
    const body = Buffer.concat([image, exif]);
    const header = Buffer.alloc(12);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(body.length + 4, 4);
    header.write("WEBP", 8, "ascii");
    const source = Buffer.concat([header, body]);
    expect(detectImage(source)).toBe("webp");
    const stripped = stripLocationMetadata(source, "webp");
    expect(stripped.toString("ascii", 8, 12)).toBe("WEBP");
    expect(stripped.includes(Buffer.from("VP8 "))).toBe(true);
    expect(stripped.includes(Buffer.from("GPSLatitude"))).toBe(false);
  });

  it("accepts HEIC without reading a location out of the file", () => {
    const heic = Buffer.alloc(24);
    heic.writeUInt32BE(24, 0);
    heic.write("ftyp", 4, "ascii");
    heic.write("heic", 8, "ascii");
    heic.write("GPSLatitude", 12, "ascii");
    expect(detectImage(heic)).toBe("heic");
    const stored = savePhoto(heic);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.filename.endsWith(".heic")).toBe(true);
    const bytes = readFileSync(resolvePhoto(stored.filename.replace(/\.heic$/, ""))!.absolute);
    expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
  });

  it("limits repeated submits from one network", () => {
    const ip = "203.0.113.50";
    expect(takePhotoSlot(ip).ok).toBe(true);
    expect(takePhotoSlot(ip).ok).toBe(true);
    expect(takePhotoSlot(ip).ok).toBe(false);
    expect(takePhotoSlot("203.0.113.51").ok).toBe(true);
    const request = new Request("https://hailmap.example/api/reports", {
      headers: { "x-forwarded-for": "198.51.100.8, 203.0.113.9", "x-real-ip": "192.0.2.4" },
    });
    expect(clientIp(request)).toBe("192.0.2.4");
  });

  it("accepts a multipart photo report and serves the image", async () => {
    const { POST } = await import("@/app/api/reports/route");
    const { GET } = await import("@/app/api/photos/[id]/route");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const form = new FormData();
    form.set("photo", new File([png], "hail.png", { type: "image/png" }));
    form.set("lat", "35.22");
    form.set("lon", "-97.44");
    form.set("sizeIn", "1");
    form.set("remark", "quarter on the driveway");
    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: form,
        headers: { "x-real-ip": "198.51.100.77" },
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      report: { confidence: string; source: string; photoUrl: string; sizeIn: number };
    };
    expect(payload.report.confidence).toBe("community");
    expect(payload.report.source).toBe("photo");
    expect(payload.report.sizeIn).toBe(1);
    const id = payload.report.photoUrl.split("/").pop() ?? "";
    const photo = await GET(new Request("http://localhost/api/photos/" + id), {
      params: Promise.resolve({ id }),
    });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await photo.arrayBuffer());
    expect(body.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it("reads a Census place label", () => {
    expect(
      placeFromCensus({
        result: {
          geographies: {
            States: [{ STUSAB: "OK" }],
            Counties: [{ BASENAME: "Cleveland" }],
            "Incorporated Places": [{ BASENAME: "Norman" }],
          },
        },
      }),
    ).toEqual({ location: "Norman", county: "Cleveland", state: "OK" });
  });
});
