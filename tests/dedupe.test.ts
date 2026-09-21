import { describe, expect, it } from "vitest";
import { fuseReports, type DedupeReport } from "@/lib/dedupe";

function report(overrides: Partial<DedupeReport> & Pick<DedupeReport, "id" | "confidence">): DedupeReport {
  return {
    lat: 35.2,
    lon: -97.4,
    occurredAt: "2026-09-21T18:00:00.000Z",
    sizeIn: 1,
    damageTags: [],
    remark: null,
    ...overrides,
  };
}

describe("fuseReports", () => {
  it("keeps the NWS report when a community report is the same hail", () => {
    const fused = fuseReports([
      report({
        id: "community",
        confidence: "community",
        damageTags: ["vehicle"],
        remark: "dented cars",
      }),
      report({
        id: "nws",
        confidence: "nws",
        damageTags: ["roof"],
        remark: null,
        occurredAt: "2026-09-21T18:10:00.000Z",
      }),
    ]);
    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe("nws");
    expect(fused[0].confidence).toBe("nws");
    expect(fused[0].damageTags).toEqual(["vehicle", "roof"]);
    expect(fused[0].remark).toBe("dented cars");
  });

  it("prefers spotter over MESH and MESH over community", () => {
    const spotterVsMesh = fuseReports([
      report({ id: "mesh", confidence: "mesh", sizeIn: 1.75 }),
      report({ id: "spotter", confidence: "spotter", sizeIn: 1.5 }),
    ]);
    expect(spotterVsMesh.map((item) => item.id)).toEqual(["spotter"]);

    const meshVsCommunity = fuseReports([
      report({ id: "community", confidence: "community" }),
      report({ id: "mesh", confidence: "mesh" }),
    ]);
    expect(meshVsCommunity.map((item) => item.id)).toEqual(["mesh"]);
  });

  it("keeps reports that are far apart, far in time, or a different size", () => {
    const far = fuseReports([
      report({ id: "a", confidence: "nws", lat: 35.2 }),
      report({ id: "b", confidence: "nws", lat: 35.4 }),
    ]);
    expect(far).toHaveLength(2);

    const close = fuseReports([
      report({ id: "a", confidence: "nws", lat: 35.2 }),
      report({ id: "b", confidence: "community", lat: 35.28 }),
    ]);
    expect(close).toHaveLength(1);

    const later = fuseReports([
      report({ id: "a", confidence: "nws", occurredAt: "2026-09-21T18:00:00.000Z" }),
      report({
        id: "b",
        confidence: "nws",
        occurredAt: new Date(Date.parse("2026-09-21T18:00:00.000Z") + 46 * 60 * 1000).toISOString(),
      }),
    ]);
    expect(later).toHaveLength(2);

    const insideWindow = fuseReports([
      report({ id: "a", confidence: "spotter", occurredAt: "2026-09-21T18:00:00.000Z" }),
      report({
        id: "b",
        confidence: "community",
        occurredAt: new Date(Date.parse("2026-09-21T18:00:00.000Z") + 45 * 60 * 1000).toISOString(),
      }),
    ]);
    expect(insideWindow).toHaveLength(1);

    const differentSize = fuseReports([
      report({ id: "small", confidence: "nws", sizeIn: 1 }),
      report({ id: "large", confidence: "nws", sizeIn: 2 }),
    ]);
    expect(differentSize).toHaveLength(2);
  });

  it("keeps a community photo beside a nearby official report", () => {
    const fused = fuseReports([
      report({ id: "nws", confidence: "nws", remark: "official lsr" }),
      {
        ...report({
          id: "photo",
          confidence: "community",
          photoId: "11111111-1111-4111-8111-111111111111.jpg",
          remark: "hail on the driveway",
        }),
        photoUrl: "/api/photos/11111111-1111-4111-8111-111111111111",
      },
    ]);
    expect(fused.map((item) => item.id).sort()).toEqual(["nws", "photo"]);
    const official = fused.find((item) => item.id === "nws");
    const photo = fused.find((item) => item.id === "photo");
    expect(official?.confidence).toBe("nws");
    expect(official?.remark).toBe("official lsr");
    expect(official?.photoId ?? null).toBeNull();
    expect(photo?.photoId).toBe("11111111-1111-4111-8111-111111111111.jpg");
    expect(photo?.photoUrl).toBe("/api/photos/11111111-1111-4111-8111-111111111111");
    expect(photo?.remark).toBe("hail on the driveway");
  });
});
