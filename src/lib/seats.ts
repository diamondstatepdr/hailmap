import { tierById } from "@/lib/billing";

/** Owner counts as one person. Unknown plans stay at one so nobody can invite by accident. */
export function seatCapForTier(id: string | null | undefined): number {
  return tierById(id ?? "")?.seats ?? 1;
}

export function teamNotice(input: { tierId: string | null; active: boolean; members: number; pending: number }): {
  canInvite: boolean;
  overCap: boolean;
  notice: string | null;
} {
  const cap = seatCapForTier(input.tierId);
  const people = 1 + input.members;
  if (!input.active) {
    return {
      canInvite: false,
      overCap: false,
      notice: "Subscribe to Crew or Storm Team to add people. Solo is one person.",
    };
  }
  if (people > cap) {
    const noun = cap === 1 ? "person" : "people";
    return {
      canInvite: false,
      overCap: true,
      notice: `This plan covers ${cap} ${noun} and the team has ${people}. Nobody was removed. Remove someone before you invite again.`,
    };
  }
  if (cap <= 1) {
    return {
      canInvite: false,
      overCap: false,
      notice: "Solo is one person. Upgrade to Crew for up to 5 people, or Storm Team for up to 15 people. Same tools on every plan.",
    };
  }
  if (people + input.pending >= cap) {
    return {
      canInvite: false,
      overCap: false,
      notice: `All ${cap} places are taken, counting invites that are still waiting.`,
    };
  }
  return { canInvite: true, overCap: false, notice: null };
}
