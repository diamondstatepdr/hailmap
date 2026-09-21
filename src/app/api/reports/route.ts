import { lookupPlace } from "@/lib/geocode";
import { getMapReports } from "@/lib/ingest";
import { clientIp, deletePhoto, detectImage, maxPhotoBytes, savePhoto, takePhotoSlot } from "@/lib/photos";
import { buildPhotoSubmission, toHailReport } from "@/lib/submit";
import { upsertReports } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getMapReports();
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[hailmap] reports", error instanceof Error ? error.message : error);
    return Response.json({ error: "Failed to load hail reports" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json({ error: "Send the photo as multipart form data" }, { status: 400 });
  }
  try {
    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) {
      return Response.json({ error: "Choose a photo of the hail" }, { status: 400 });
    }
    if (photo.size > maxPhotoBytes()) {
      return Response.json({ error: "Photo is too large (8 MB max)" }, { status: 413 });
    }
    if (photo.size < 32) {
      return Response.json({ error: "That file is not a usable photo" }, { status: 400 });
    }
    const bytes = Buffer.from(await photo.arrayBuffer());
    if (!detectImage(bytes)) {
      return Response.json({ error: "Use a JPEG, PNG, WebP, or HEIC photo" }, { status: 400 });
    }
    const slot = takePhotoSlot(clientIp(request));
    if (!slot.ok) {
      return Response.json({ error: slot.error }, { status: 429, headers: { "Retry-After": "3600" } });
    }
    const stored = savePhoto(bytes);
    if (!stored.ok) return Response.json({ error: stored.error }, { status: 400 });

    const built = buildPhotoSubmission({
      lat: form.get("lat"),
      lon: form.get("lon"),
      sizeIn: form.get("sizeIn") ?? form.get("size"),
      occurredAt: form.get("occurredAt"),
      location: form.get("location"),
      county: form.get("county"),
      state: form.get("state"),
      remark: form.get("remark") ?? form.get("note"),
      photoId: stored.filename,
    });
    if (!built.ok) {
      deletePhoto(stored.filename);
      return Response.json({ error: built.error }, { status: 400 });
    }

    const place = await lookupPlace(built.report.lat, built.report.lon);
    if (!built.report.location && place.location) built.report.location = place.location;
    if (!built.report.county && place.county) built.report.county = place.county;
    if (!built.report.state && place.state) built.report.state = place.state;

    upsertReports([built.report]);
    return Response.json({ ok: true, report: toHailReport(built.report) }, { status: 201 });
  } catch (error) {
    console.error("[hailmap] photo report", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not save that photo report" }, { status: 400 });
  }
}
