import { parseImportText, saveImportedReports } from "@/lib/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let text = "";
    let filename = "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "Attach a CSV or GeoJSON file" }, { status: 400 });
      }
      filename = file.name;
      text = await file.text();
    } else {
      text = await request.text();
      filename = contentType.includes("json") ? "upload.geojson" : "upload.csv";
    }
    if (text.length > 2_000_000) {
      return Response.json({ error: "File is too large (2 MB max)" }, { status: 413 });
    }
    const reports = parseImportText(text, filename);
    if (!reports.length) {
      return Response.json(
        { error: "No hail reports found. CSV needs lat, lon, and optional size, time, location, county, state, remark." },
        { status: 400 },
      );
    }
    const inserted = saveImportedReports(reports);
    return Response.json({ ok: true, inserted });
  } catch (error) {
    console.error("[hailmap] import", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not read that file" }, { status: 400 });
  }
}
