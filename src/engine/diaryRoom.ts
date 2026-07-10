import type { KnowledgeFact } from "../domain/knowledge";

/**
 * The Diary Room (feature 0013) — engine-side logic for the two distinct things
 * that wear the name, kept apart because the split is an integrity boundary:
 *
 *  - **Player DR → no NPC.** Player Diary-Room content is the player's OWN
 *    knowledge (recorded by `KnowledgeService.recordDiaryRoom`, pathway
 *    "diary-room"), but it has NO in-game pathway to any NPC — NPC-knowledge
 *    derivation MUST exclude it. This module owns that wall. The DR is the player's
 *    private, out-of-character strategy channel: a journal + the public/private
 *    duplicity enabler + a season-retrospective payoff (0048).
 *    **Feature 0115** gives it teeth WITHOUT breaching the wall: the player's DR
 *    intent GROUNDS the GM's narration (so the game narrates the player's REAL
 *    strategy — the irony of a lie — not their public mask), the producer's
 *    invitations become pointed beat-specific questions, and the confessionals
 *    resurface in the retrospective. All three are PLAYER-FACING: DR still never
 *    reaches any NPC's knowledge and never drives any NPC's behavior (that stays
 *    structural — `deriveNpcKnowledge` below is the guarantee, and it is unchanged).
 *  - **NPC confessionals → Vault-only** are handled by the Vault Wall (0001):
 *    recorded with a witness set excluding the player, they never surface.
 *
 * PURE and Vault-free.
 */

/** The pathway tag marking player Diary-Room content: player knowledge, no NPC pathway. */
export const NO_NPC_PATHWAY = "diary-room";

/** A fact is NPC-reachable unless it is Diary-Room (player-only, OOC) content. */
export function isNpcReachable(fact: { pathway: string }): boolean {
  return fact.pathway !== NO_NPC_PATHWAY;
}

/**
 * The DR → NPC wall: given any candidate facts that might inform an NPC, strip
 * Diary-Room content. NPC-knowledge derivation MUST route through this, so even
 * an accidental attempt to feed player knowledge to an NPC drops the DR entirely.
 */
export function deriveNpcKnowledge(candidate: readonly KnowledgeFact[]): KnowledgeFact[] {
  return candidate.filter(isNpcReachable);
}

/** Beats the game can be at; only the dramatic ones warrant a producer DR prompt. */
export type Beat =
  | "eviction" | "nomination" | "veto-ceremony" | "position-shift"
  | "routine-chat" | "idle" | "downtime";

const DRAMATIC: ReadonlySet<Beat> = new Set<Beat>([
  "eviction", "nomination", "veto-ceremony", "position-shift",
]);

export function isDramatic(beat: Beat): boolean {
  return DRAMATIC.has(beat);
}

/**
 * 0115 — the pointed, beat-specific confessional question the producer asks at each dramatic beat
 * (replaces the old generic `dramatic beat: X` label). Player-facing, Vault-free, non-numeric — a
 * prompt to draw out the player's real read, which the FE voices as the DR invitation and which the
 * player's answer (a normal walled DR entry) then feeds back into the narration grounding.
 */
export const DRAMATIC_PROMPTS: Record<string, string> = {
  nomination: "You've named your nominees — who are you really after, and who did you just protect?",
  "veto-ceremony": "The veto's in play — what's the move if it lands on someone you wanted gone?",
  eviction: "Someone's about to walk — how do you want the house to remember your vote?",
  "position-shift": "The board just shifted under you — what's your real read now?",
};

/**
 * A producer DR invitation. Fires ONLY at a dramatic beat — a producer gently pulling the player
 * aside when the story turns, never an every-turn interruption. `reason` is a pointed beat-specific
 * QUESTION (0115), not a bare label.
 */
export function producerPrompt(beat: Beat): { invite: boolean; reason?: string } {
  if (!isDramatic(beat)) return { invite: false };
  return { invite: true, reason: DRAMATIC_PROMPTS[beat] ?? `What's your read on this ${beat}?` };
}

/**
 * 0115 — project the player's Diary-Room strategy for the player-facing surfaces (the narrator's
 * private steer + the retrospective through-line). PURE and Vault-free: it reads ONLY the player's
 * own `NO_NPC_PATHWAY` knowledge (never a Vault read, never any NPC's knowledge), most-recent-first,
 * capped. This never touches NPC knowledge or behavior — the wall (`deriveNpcKnowledge`) is unchanged.
 */
export function playerDiaryStrategy(
  playerKnowledge: readonly { content: string; pathway?: string }[],
  cap = 6,
): string[] {
  // The player's knowledge reader returns facts in INSERTION order (oldest-first), so reverse for
  // most-recent-first, then cap. No timestamp needed — order is the record.
  return playerKnowledge
    .filter((k) => k.pathway === NO_NPC_PATHWAY)
    .map((k) => k.content)
    .reverse()
    .slice(0, cap);
}

/**
 * Maps the live season's current `moment` key (`momentForPhase` in `momentPrompts.ts` — the same
 * string the FE already reads every turn off `GameStateView.moment`) onto a `producerPrompt` `Beat`.
 * This is the seam that makes `producerPrompt` a real, live-wired function instead of a hook nobody
 * calls: `GameSessionAdapter.view()` calls `producerPrompt(beatForMoment(moment))` to compute
 * `diaryRoomInvite`. Any moment not named here reads as routine (no invite) — conservative by
 * default, so a new moment key never accidentally starts inviting the player.
 */
export function beatForMoment(moment: string): Beat {
  switch (moment) {
    case "nominations":
      return "nomination";
    case "veto-ceremony":
      return "veto-ceremony";
    case "eviction":
      return "eviction";
    default:
      return "routine-chat";
  }
}
