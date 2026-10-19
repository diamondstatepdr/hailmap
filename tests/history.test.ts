import { describe, expect, it } from "vitest";
import { clusterReports, shouldCluster } from "@/lib/history-cluster";
import { groupEvents, isLossCandidate, lossCandidates, defaultScoreDate, rangeMaxHail, type AddressEvent } from "@/lib/history-place";
import { hailCalendarBand, monthCells } from "@/lib/hail-calendar";
import { lastDays, parseSpan } from "@/lib/history-range";
import { MESH_ARCHIVE_START } from "@/lib/history-coverage";
import { pickMeshArchiveName, planMesh } from "@/lib/mesh-plan";
import { parseSvrgisCsv, spcCstToIso } from "@/lib/spc-archive";

const hailCsv = `om,yr,mo,dy,date,time,tz,st,stf,stn,mag,inj,fat,loss,closs,slat,slon,elat,elon,len,wid,ns,sn,sg,f1,f2,f3,f4
2505081830-01,2024,05,08,2024-05-08,18:30:00,3,TX,48,0,2.75,0,0,0,0,32.7800,-96.8000,32.7800,-96.8000,0,0,0,0,0,113,0,0,0
1,1955,1,17,1955-01-17,16:39:00,3,TX,48,1,0.75,0,0,0,0,32.2000,-101.5000,0,0,0,0,0,0,0,227,0,0,0
`;

describe("SPC severe database", () => {
  it("reads hail size in inches and stores Central Standard Time as UTC", () => {
    const rows = parseSvrgisCsv(hailCsv, "hail");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      stormDate: "2024-05-08",
      state: "TX",
      sizeIn: 2.75,
      lat: 32.78,
      lon: -96.8,
      confidence: "nws",
    });
    expect(rows[0].occurredAt).toBe("2024-05-09T00:30:00.000Z");
    expect(rows[1].stormDate).toBe("1955-01-17");
    expect(spcCstToIso("2024-05-08", "18:30:00")).toBe("2024-05-09T00:30:00.000Z");
  });

  it("converts wind knots to miles per hour and keeps tornado ratings", () => {
    const wind = parseSvrgisCsv(
      `om,date,time,tz,st,mag,slat,slon
1,2024-06-01,21:00:00,3,CO,60,39.7,-104.9`,
      "wind",
    );
    expect(wind[0].windMph).toBe(69);
    const tornado = parseSvrgisCsv(
      `om,date,time,tz,st,mag,slat,slon
9,2011-04-27,20:00:00,3,AL,4,33.5,-86.8`,
      "tornado",
    );
    expect(tornado[0].efRating).toBe("EF4");
    const early = parseSvrgisCsv(
      `om,date,time,tz,st,mag,slat,slon
9,1953-05-11,21:00:00,3,TX,5,31.7,-106.4`,
      "tornado",
    );
    expect(early[0].efRating).toBe("F5");
  });
});

describe("history ranges and clusters", () => {
  it("builds inclusive day spans and rejects dates before 1950", () => {
    expect(lastDays(30, new Date("2026-10-19T18:00:00Z"))).toEqual({ start: "2026-09-20", end: "2026-10-19" });
    expect(parseSpan("1949-12-31", "1950-01-02")).toEqual({ error: "Storm reports in this archive start in 1950." });
    expect(parseSpan("2024-05-01", "2024-05-08")).toEqual({ start: "2024-05-01", end: "2024-05-08" });
  });

  it("clusters a wide set of reports and keeps the largest hail", () => {
    const points = Array.from({ length: 20 }, (_, index) => ({
      lat: 32.7 + index * 0.01,
      lon: -96.8,
      hazard: "hail" as const,
      sizeIn: index === 7 ? 2.5 : 1,
      windMph: null,
      efRating: null,
      efRank: -1,
      occurredAt: "2024-05-08T22:00:00.000Z",
      stormDate: "2024-05-08",
    }));
    expect(shouldCluster(20, 1)).toBe(false);
    expect(shouldCluster(3000, 2)).toBe(true);
    const clusters = clusterReports(points, 1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(20);
    expect(clusters[0].maxHailIn).toBe(2.5);
  });
});

describe("address events", () => {
  it("scores the strongest hail day and does not mark wind-only days as pending radar", () => {
    const rows = [
      row("2024-05-08", "hail", 2.5),
      row("2025-04-02", "wind", null, 70),
      row("2023-06-01", "hail", 0.75),
    ];
    const events = groupEvents(rows, [], new Map([["2024-05-08", { maxIn: 2.1, status: "ok" }]]));
    expect(events.map((event) => event.date)).toEqual(["2025-04-02", "2024-05-08", "2023-06-01"]);
    expect(events.find((event) => event.date === "2024-05-08")?.lossCandidate).toBe(true);
    expect(events.find((event) => event.date === "2023-06-01")?.lossCandidate).toBe(false);
    expect(events.find((event) => event.date === "2025-04-02")?.meshStatus).toBe("no-hail");
    expect(events.find((event) => event.date === "2023-06-01")?.meshStatus).toBe("pending");
    expect(defaultScoreDate(events)).toBe("2024-05-08");
    expect(defaultScoreDate(events)).toBe(lossCandidates(events)[0]?.date);
    expect(rangeMaxHail(events)).toBe(2.5);
    expect(lossCandidates(events).map((event) => event.date)).toEqual(["2024-05-08", "2025-04-02"]);
    expect(isLossCandidate({ spotterMaxIn: 0.75, meshMaxIn: 1.25, windMaxMph: null, tornadoCount: 0 })).toBe(true);
  });
});

describe("hail calendar", () => {
  it("sizes dots by 1, 1.75, and 2.5 inch hail and lays out April 2026", () => {
    expect(hailCalendarBand(0.75).id).toBe("under-1");
    expect(hailCalendarBand(1).label).toBe("1\"+");
    expect(hailCalendarBand(1.75).px).toBeGreaterThan(hailCalendarBand(1).px);
    expect(hailCalendarBand(2.5).id).toBe("2.5");
    expect(hailCalendarBand(6.12).color).toBe("#dc2626");
    const cells = monthCells(2026, 4);
    expect(cells[0]).toBeNull();
    expect(cells[3]).toBe("2026-04-01");
    expect(cells).toContain("2026-04-25");
    expect(cells.filter(Boolean)).toHaveLength(30);
  });
});

describe("MESH archive names", () => {
  it("prefers the file closest to 12:00 UTC and rejects dates before the archive", () => {
    const name = pickMeshArchiveName([
      "MRMS_Max_1440min_00.50_20191001-125037.grib2.gz",
      "MRMS_Max_1440min_00.50_20191001-122033.grib2.gz",
    ]);
    expect(name).toBe("MRMS_Max_1440min_00.50_20191001-122033.grib2.gz");
    const now = new Date("2026-10-19T12:00:00Z");
    expect(planMesh({ date: "2019-09-27", now })).toEqual({
      error: "Radar hail swaths in the Iowa State archive start on 2019-09-28.",
    });
    expect(planMesh({ date: MESH_ARCHIVE_START, now })).toMatchObject({ mode: "days", dates: [MESH_ARCHIVE_START] });
  });
});

function row(date: string, hazard: "hail" | "wind" | "tornado", sizeIn: number | null, windMph: number | null = null) {
  return {
    id: `${date}-${hazard}`,
    source: "spc-svrgis",
    confidence: "nws" as const,
    hazard,
    lat: 32.78,
    lon: -96.8,
    sizeIn,
    windMph,
    efRating: null,
    efRank: -1,
    occurredAt: `${date}T22:00:00.000Z`,
    stormDate: date,
    state: "TX",
    location: null,
    county: null,
    distanceKm: 2,
  };
}

void 0 as AddressEvent["meshStatus"];
