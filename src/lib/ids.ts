import { createHash } from "node:crypto";

export function stableId(parts: Array<string | number | null | undefined>): string {
  return createHash("sha1")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex")
    .slice(0, 20);
}
