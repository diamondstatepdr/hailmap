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
