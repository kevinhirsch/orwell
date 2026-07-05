import type { KnowledgeFact } from "../domain/knowledge";

/**
 * The Diary Room (feature 0013) — engine-side logic for the two distinct things
 * that wear the name, kept apart because the split is an integrity boundary:
 *
 *  - **Player DR → no NPC.** Player Diary-Room content is the player's OWN
 *    knowledge (recorded by `KnowledgeService.recordDiaryRoom`, pathway
 *    "diary-room"), but it has NO in-game pathway to any NPC — NPC-knowledge
 *    derivation MUST exclude it. This module owns that wall. The DR is an
 *    EXPRESSIVE, out-of-character channel: a private journal + the public/private
 *    duplicity enabler + a season-retrospective payoff (0048). It deliberately has
 *    NO live mechanical effect (anti-sycophancy — it can never puppeteer an NPC or
 *    change an outcome). A purposeful engine read of the player's stated strategy is
 *    a DEFERRED future feature (PO backlog: "Diary Room with purpose"), not wired here.
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
 * A producer DR invitation. Fires ONLY at a dramatic beat — a producer gently
 * pulling the player aside when the story turns, never an every-turn interruption.
 */
export function producerPrompt(beat: Beat): { invite: boolean; reason?: string } {
  return isDramatic(beat) ? { invite: true, reason: `dramatic beat: ${beat}` } : { invite: false };
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
