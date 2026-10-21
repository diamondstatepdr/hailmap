import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/hail-proof/route";
import { GET } from "@/app/api/hail-proof/[id]/route";
import { GET as readIdentity, PUT as saveIdentity } from "@/app/api/hail-proof/identity/route";
import { signSession } from "@/lib/auth";
import {
  nearbyLines,
  normalizeProof,
  proofFilename,
  proofMapSvg,
  proofSwathStat,
  ringsNearPoint,
  stormsFromDaily,
  swathCaptionNearPoint,
} from "@/lib/hail-proof";
import { unproject } from "@/lib/geo";
import { renderHailProofPdf } from "@/lib/hail-proof-pdf";
import { decideConfirmation, type LsrHit } from "@/lib/proof-confirm";
import { statLine } from "@/lib/swath-measure";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-proof-"));
process.env.HAILMAP_DATA_DIR = dataDir;

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const draft = {
  address: "3500 W 7th St, Fort Worth",
  lat: 32.75,
  lon: -97.33,
  maxHailIn: 1.75,
  score: 64,
  level: "High",
  summary: "Radar hail of 1.75 in is the strongest evidence at this address.",
  storms: [
    { date: "2026-04-25", label: "Apr 25, 2026", hailIn: 1.75 },
    { date: "2026-03-02", label: "Mar 2, 2026", hailIn: 1 },
  ],
  nearby: [{ when: "2026-04-25", where: "Fort Worth", detail: "1.75 in hail" }],
  rings: [
    [
      [-97.36, 32.73],
      [-97.3, 32.73],
      [-97.3, 32.77],
      [-97.36, 32.77],
    ],
  ],
};

describe("hail proof document", () => {
  it("keeps storm dates, hail size, and a swath ring near the address", () => {
    const proof = normalizeProof(draft, "2026-04-26T12:00:00.000Z");
    expect("error" in proof).toBe(false);
    if ("error" in proof) return;
    expect(proof.maxHailIn).toBe(1.75);
    expect(proof.level).toBe("High");
    expect(proof.storms.map((storm) => storm.date)).toEqual(["2026-04-25", "2026-03-02"]);
    expect(proof.rings).toHaveLength(1);
    expect(proofFilename(proof.address)).toBe("Swathline-hail-proof-3500-w-7th-st-fort-worth.pdf");
    expect(stormsFromDaily([{ date: "2026-04-25", label: "Apr 25", meshMaxIn: 1.25, spotterMaxIn: 1.75 }])[0].hailIn).toBe(1.75);
    expect(nearbyLines([{ when: "Apr 25", where: "Fort Worth", detail: "1.75 in" }])).toHaveLength(1);
    const kept = ringsNearPoint(
      [
        { geometry: { type: "Polygon", coordinates: [draft.rings[0]] } },
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-80, 25],
                [-79, 25],
                [-79, 26],
                [-80, 26],
              ],
            ],
          },
        },
      ],
      32.75,
      -97.33,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.color).toBe("#f97316");
    const covering = ringsNearPoint(
      [
        {
          properties: { minIn: 1.5, color: "#f97316" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-98.2, 32.0],
                [-96.4, 32.0],
                [-96.4, 33.5],
                [-98.2, 33.5],
              ],
            ],
          },
        },
      ],
      32.75,
      -97.33,
    );
    expect(covering).toHaveLength(1);
    expect(covering[0]?.color).toBe("#f97316");
  });

  it("renders a branded PDF with the address, hail size, score, and swath map", () => {
    const proof = normalizeProof(draft, "2026-04-26T12:00:00.000Z");
    if ("error" in proof) throw new Error(proof.error);
    const pdf = renderHailProofPdf(proof);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("SWATHLINE");
    expect(text).toContain("Hail proof");
    expect(text).toContain("3500 W 7th St, Fort Worth");
    expect(text).toContain("1.75 in");
    expect(text).toContain("High");
    expect(text).toContain("Apr 25, 2026");
    expect(text).toContain("not a roof inspection");
    expect(text).not.toContain("Company");
    expect(text).not.toContain("480-");
    const named = normalizeProof({ ...draft, company: "Diamond State PDR", phone: "480-800-0148" }, "2026-04-26T12:00:00.000Z");
    if ("error" in named) throw new Error(named.error);
    expect(renderHailProofPdf(named).toString("latin1")).toContain("Diamond State PDR");
    expect(renderHailProofPdf(named).toString("latin1")).toContain("480-800-0148");
    expect(text).toContain("sq mi");
    const rectangle = [
      [0, 0],
      [3.218688, 0],
      [3.218688, 1.609344],
      [0, 1.609344],
      [0, 0],
    ].map(([x, y]) => {
      const point = unproject(x, y, -97.33, 32.75);
      return [point.lon, point.lat];
    });
    expect(proofSwathStat([rectangle])).toBe("2 mi long · 1 mi wide · 2 sq mi");
    const full = { type: "Polygon" as const, coordinates: [rectangle] };
    const center = unproject(1.6, 0.8, -97.33, 32.75);
    const caption = swathCaptionNearPoint([{ geometry: full, properties: { minIn: 1.5, maxIn: 1.5 } }], center.lat, center.lon);
    expect(caption).toBe("2 mi long · 1 mi wide · 2 sq mi");
    const stored = normalizeProof({ ...draft, swathLine: "42 mi long · 5.6 mi wide · 122 sq mi" }, "2026-04-26T12:00:00.000Z");
    if ("error" in stored) throw new Error(stored.error);
    const storedText = renderHailProofPdf(stored).toString("latin1");
    expect(storedText).toContain("42 mi long");
    expect(storedText).toContain("5.6 mi wide");
    expect(storedText).toContain("122 sq mi");
    expect(statLine({ lengthMi: 42, widthMi: 5.6, areaSqMi: 122, axisDeg: null })).toBe("42 mi long · 5.6 mi wide · 122 sq mi");
    expect(proofMapSvg(proof)).toContain("Swath map");
    expect(proofMapSvg(proof)).toContain("<path");
    expect(proofMapSvg(proof)).toContain("#f97316");
    expect(proofMapSvg(proof)).not.toContain("#9d174d");
  });

  it("prints the seal only when radar hail is at least 1 inch and a spotter report matches", () => {
    const mesa: LsrHit = {
      occurredAt: "2026-10-21T05:10:00.000Z",
      lat: 33.38,
      lon: -111.87,
      sizeIn: 1,
      where: "3 SW Mesa, Maricopa, AZ",
      remark: "Report from mPING: Quarter (1.00 in.). (PSR)",
      observer: null,
      from: "spc",
    };
    const gilbert: LsrHit = {
      ...mesa,
      lat: 33.35,
      lon: -111.84,
      where: "3 W Gilbert, Maricopa, AZ",
      remark: "Dime to quarter size. (PSR)",
    };
    const late: LsrHit = { ...mesa, occurredAt: "2026-10-21T07:30:00.000Z" };
    const confirmed = decideConfirmation({
      lat: 33.415,
      lon: -111.837,
      radarIn: 2.53,
      radarAt: "2026-10-21T05:12:00.000Z",
      radarKind: "scan",
      reports: [mesa, gilbert, late],
    });
    expect(confirmed.seal).toBe(true);
    expect(confirmed.headline).toBe("Radar + spotter confirmed");
    expect(confirmed.reports).toHaveLength(1);
    expect(confirmed.reports[0]?.source).toContain("mPING");
    expect(confirmed.reports[0]?.source).toContain("PSR");
    expect(confirmed.reports[0]?.distanceMi).toBe(3.1);
    expect(confirmed.reports[0]?.timeUtc).toBe("05:10 UTC");
    expect(confirmed.reports[0]?.timeLocal).toMatch(/Oct 20, 10:10 PM/);
    expect(confirmed.radarLine).toContain("Oct 20, 10:12 PM MST");
    expect(confirmed.radarLine).toContain("(05:12 UTC)");
    expect(confirmed.radarLine).not.toMatch(/2026-10-21/);
    expect(confirmed.radarUtc).toBe("05:12 UTC");
    expect(confirmed.disclaimer).toContain("not a meteorologist certification");
    expect(confirmed.disclaimer).toContain("not an insurance decision");

    const small = decideConfirmation({
      lat: 33.415,
      lon: -111.837,
      radarIn: 0.75,
      radarAt: "2026-10-21T05:12:00.000Z",
      radarKind: "scan",
      reports: [mesa],
    });
    expect(small.seal).toBe(false);
    expect(small.headline).toBe("Radar only");
    expect(small.reports).toHaveLength(1);

    const daily = decideConfirmation({
      lat: 33.415,
      lon: -111.837,
      radarIn: 2.53,
      radarAt: "2026-10-21T12:00:00.000Z",
      radarKind: "daily",
      reports: [mesa],
    });
    expect(daily.seal).toBe(false);
    expect(daily.reports).toHaveLength(0);

    const proof = normalizeProof(
      {
        ...draft,
        confirm: {
          seal: true,
          headline: "Radar + spotter confirmed",
          radarIn: 0.4,
          radarAt: "2026-10-21T05:12:00.000Z",
          radarKind: "scan",
          radarLine: "Radar scan 0.40 in",
          note: "",
          reports: [{ timeUtc: "2026-10-21 05:10 UTC", timeLocal: "Oct 20, 10:10 PM MST", sizeIn: 1, distanceMi: 3.1, source: "SPC Local Storm Report · mPING · PSR", where: "3 SW Mesa" }],
          disclaimer: "forged",
        },
      },
      "2026-04-26T12:00:00.000Z",
    );
    if ("error" in proof) throw new Error(proof.error);
    expect(proof.confirm?.seal).toBe(false);
    expect(proof.confirm?.headline).toBe("Radar only");
    const quiet = renderHailProofPdf(proof).toString("latin1");
    expect(quiet).toContain("Radar only");
    expect(quiet).not.toContain("Radar + spotter confirmed");
    expect(quiet).toContain("not a meteorologist certification");
    expect(quiet).not.toContain("Company");

    const sealed = normalizeProof(
      {
        ...draft,
        confirm: {
          ...confirmed,
          reports: confirmed.reports,
        },
      },
      "2026-04-26T12:00:00.000Z",
    );
    if ("error" in sealed) throw new Error(sealed.error);
    const sealedText = renderHailProofPdf(sealed).toString("latin1");
    expect(sealedText).toContain("RADAR +");
    expect(sealedText).toContain("SPOTTER");
    expect(sealedText).toContain("CONFIRMED");
    expect(sealedText).toContain("Oct 20, 10:12 PM MST");
    expect(sealedText).toContain("05:12 UTC");
    expect(sealedText).not.toMatch(/2026-10-21/);
    expect(sealedText).toContain("mPING");
    expect(sealedText).toContain("3.1 mi");
    expect(sealedText).toContain("not an insurance decision");
    expect(sealedText).not.toContain("certified meteorologist");
    const emptyNearby = normalizeProof({ ...draft, nearby: [], confirm: confirmed }, "2026-04-26T12:00:00.000Z");
    if ("error" in emptyNearby) throw new Error(emptyNearby.error);
    const emptyText = renderHailProofPdf(emptyNearby).toString("latin1");
    expect(emptyText).not.toMatch(/No nearby reports/i);
    expect(emptyText).not.toMatch(/None in this view/i);
    expect(emptyText).not.toContain("Nearby reports");
  });

  it("rejects a proof with no address and serves a saved PDF", async () => {
    const missing = await POST(
      new Request("http://localhost/api/hail-proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: 32.75, lon: -97.33 }),
      }),
    );
    expect(missing.status).toBe(400);

    const created = await POST(
      new Request("http://localhost/api/hail-proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; pdfUrl: string; url: string; filename: string };
    expect(body.url).toBe(`/proof/${body.id}`);
    expect(body.filename.endsWith(".pdf")).toBe(true);
    const pdf = await GET(new Request(`http://localhost${body.pdfUrl}`), { params: Promise.resolve({ id: body.id }) });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.toString("latin1")).toContain("3500 W 7th St");
    expect(bytes.toString("latin1")).not.toContain("Radar + spotter confirmed");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("rpts_hail")) {
        return new Response(
          "Time,Size,Location,County,State,Lat,Lon,Comments\n0510,100,3 SW Mesa,Maricopa,AZ,33.38,-111.87,Report from mPING: Quarter (1.00 in.). (PSR)\n",
          { status: 200 },
        );
      }
      if (href.includes("lsr.py")) return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), { status: 200 });
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    try {
      const forged = await POST(
        new Request("http://localhost/api/hail-proof", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...draft,
            lat: 33.415,
            lon: -111.837,
            address: "East Main Street, Mesa, AZ",
            stormDate: "2026-10-20",
            confirm: {
              seal: true,
              headline: "Radar + spotter confirmed",
              radarIn: 2.5,
              radarAt: "2026-10-21T05:10:00.000Z",
              radarKind: "scan",
              radarLine: "forged",
              reports: [{ timeUtc: "2026-10-21 05:10 UTC", timeLocal: "10:10 PM MST", sizeIn: 1, distanceMi: 1, source: "forged", where: "Mesa" }],
            },
          }),
        }),
      );
      expect(forged.status).toBe(201);
      const forgedBody = (await forged.json()) as { pdfUrl: string };
      const forgedPdf = await GET(new Request(`http://localhost${forgedBody.pdfUrl}`), {
        params: Promise.resolve({ id: forgedBody.pdfUrl.split("/").pop() ?? "" }),
      });
      const forgedText = Buffer.from(await forgedPdf.arrayBuffer()).toString("latin1");
      expect(forgedText).toContain("Radar only");
      expect(forgedText).not.toContain("RADAR +");
      expect(forgedText).toContain("24-hour radar maximum");
      expect(forgedText).toContain("Oct 20, 2026");
      expect(forgedText).toContain("Oct 21, 5:00 AM MST");
      expect(forgedText).not.toContain("2026-10-21 12:00");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("saves a blank company and phone for the signed-in team", async () => {
    process.env.HAILMAP_TEAM_PASSCODE = "team-pass";
    process.env.HAILMAP_AUTH_SECRET = "test-secret";
    const denied = await readIdentity(new Request("http://localhost/api/hail-proof/identity"));
    expect(denied.status).toBe(401);
    const cookie = `hailmap_session=${encodeURIComponent(signSession({ id: "alex", name: "Alex" }))}`;
    const saved = await saveIdentity(
      new Request("http://localhost/api/hail-proof/identity", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ company: "North Side Roofs", phone: "480-555-0199" }),
      }),
    );
    expect(saved.status).toBe(200);
    const loaded = await readIdentity(new Request("http://localhost/api/hail-proof/identity", { headers: { cookie } }));
    expect(await loaded.json()).toEqual({ company: "North Side Roofs", phone: "480-555-0199" });
    const cleared = await saveIdentity(
      new Request("http://localhost/api/hail-proof/identity", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ company: "  ", phone: "" }),
      }),
    );
    expect(await cleared.json()).toEqual({ company: "", phone: "" });
  });
});
