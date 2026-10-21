import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "@/lib/proof-map";

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  const { crc32 } = awaitableCrc();
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return crc ^ 0xffffffff;
}

function awaitableCrc() {
  return { crc32 };
}

function rgbPng(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("proof map tiles", () => {
  it("decodes an 8-bit RGB png", () => {
    const png = rgbPng(2, 1, Buffer.from([255, 0, 0, 0, 0, 255]));
    const image = decodePng(png);
    expect(image?.width).toBe(2);
    expect(image?.height).toBe(1);
    expect(Array.from(image?.rgba ?? []).slice(0, 8)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });
});
