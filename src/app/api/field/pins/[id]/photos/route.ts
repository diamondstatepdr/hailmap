import { addFieldPhoto, asDamageType } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { clientIp, deletePhoto, detectImage, maxPhotoBytes, savePhoto, takePhotoSlot } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THIRTY_DAYS = 30 * 86400000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json({ error: "Send the photo as multipart form data" }, { status: 400 });
  }
  try {
    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) return Response.json({ error: "Choose a photo" }, { status: 400 });
    if (photo.size > maxPhotoBytes()) return Response.json({ error: "Photo is too large (8 MB max)" }, { status: 413 });
    const bytes = Buffer.from(await photo.arrayBuffer());
    if (!detectImage(bytes)) return Response.json({ error: "Use a JPEG, PNG, WebP, or HEIC photo" }, { status: 400 });
    const damageType = asDamageType(form.get("damageType"));
    if (!damageType) {
      return Response.json({ error: "damageType must be hail, wind, roof, siding, vehicle, or gutters" }, { status: 400 });
    }
    const provided = String(form.get("takenAt") ?? "").trim();
    const when = new Date(provided || Date.now());
    if (Number.isNaN(when.getTime())) return Response.json({ error: "Invalid time" }, { status: 400 });
    if (when.getTime() > Date.now() + 15 * 60 * 1000) return Response.json({ error: "Time is in the future" }, { status: 400 });
    if (Date.now() - when.getTime() > THIRTY_DAYS) {
      return Response.json({ error: "Photos must be from the last 30 days" }, { status: 400 });
    }
    const slot = takePhotoSlot(clientIp(request));
    if (!slot.ok) return Response.json({ error: slot.error }, { status: 429, headers: { "Retry-After": "3600" } });
    const stored = savePhoto(bytes);
    if (!stored.ok) return Response.json({ error: stored.error }, { status: 400 });
    const noteRaw = form.get("note");
    const note = noteRaw == null ? null : String(noteRaw).trim().slice(0, 500) || null;
    const saved = addFieldPhoto({
      userId: auth.user.id,
      pinId: id,
      photoId: stored.filename,
      damageType,
      note,
      takenAt: when.toISOString(),
    });
    if (!saved) {
      deletePhoto(stored.filename);
      return Response.json({ error: "That pin was not found" }, { status: 404 });
    }
    return Response.json({ photo: saved }, { status: 201 });
  } catch (error) {
    console.error("[hailmap] field photo", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not save that photo" }, { status: 400 });
  }
}
