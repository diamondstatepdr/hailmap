export const PIN_STATUSES = ["damage", "talked", "away", "lead"] as const;
export type PinStatus = (typeof PIN_STATUSES)[number];

export const FIELD_DAMAGE_TYPES = ["hail", "wind", "roof", "siding", "vehicle", "gutters"] as const;
export type FieldDamageType = (typeof FIELD_DAMAGE_TYPES)[number];

export function asPinStatus(value: unknown): PinStatus | null {
  return PIN_STATUSES.find((status) => status === value) ?? null;
}

export function asDamageType(value: unknown): FieldDamageType | null {
  return FIELD_DAMAGE_TYPES.find((type) => type === value) ?? null;
}

export function pinStatusLabel(status: PinStatus): string {
  if (status === "damage") return "Damage seen";
  if (status === "talked") return "Talked to owner";
  if (status === "away") return "Not home";
  return "Lead";
}
