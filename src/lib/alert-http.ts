import { deviceFromKey, type PushDevice } from "@/lib/alert-store";

export function deviceKeyFrom(request: Request): string {
  const header = request.headers.get("x-hailmap-device")?.trim();
  if (header) return header;
  const bearer = request.headers.get("authorization") ?? "";
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return "";
}

export function requireDevice(request: Request): { device: PushDevice } | { response: Response } {
  const key = deviceKeyFrom(request);
  if (!key) return { response: Response.json({ error: "Missing device key" }, { status: 401 }) };
  const device = deviceFromKey(key);
  if (!device) return { response: Response.json({ error: "This phone is not subscribed" }, { status: 401 }) };
  return { device };
}

export async function readJson(request: Request): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { response: Response.json({ error: "Expected a JSON object" }, { status: 400 }) };
    }
    return { body: body as Record<string, unknown> };
  } catch {
    return { response: Response.json({ error: "Expected a JSON body" }, { status: 400 }) };
  }
}
