import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { TEMPERATURE_CONSTANTS } from "../domain/temperatureConstants";
import type { RelationshipModel } from "./relationships";

/**
 * The conversation & scene system (feature 0012) — the engine-side logic behind
 * the player's social game. PURE and Vault-free: it decides *who* approaches and
 * *what an NPC may legitimately say*, never narration (that is the LLM's job) and
 * never ground truth beyond what the relationship/knowledge models already own.
 *
 * Two responsibilities live here:
 *  1. Bidirectional initiation — which NPCs seek out the player, driven by their
 *     relationship reads (agenda), not chance.
 *  2. Knowledge-constrained dialogue — an NPC may only ASSERT what it legitimately
 *     knows (0002); otherwise it can suspect, or stay silent. It can never voice a
 *     fact it has no in-game pathway to.
 */

/** A minimal knowledge/suspicion shape — matches `KnowledgeFact` / `Suspicion`. */
export interface Claimable {
  content: string;
}

/**
 * The COARSE category of why an NPC seeks the player (audit E60 / ADR 0003 principle 2):
 * `bond` — their tie to the player is the stronger agenda (allies scheme, friends check in);
 * `probe` — their threat read on the player is (rivals size up, the wary fish for intent).
 * This is the FACT the narrator voices in its own words; the underlying number never crosses.
 */
export type ApproachMotive = "bond" | "probe";

export interface Approach {
  npc: EntityId;
  /** Relationship-derived motivation to seek the player (bond or threat). */
  drive: number;
  /** Which agenda won: the bond read or the threat read (Vault-safe category, never the number). */
  motive: ApproachMotive;
}

/**
 * Which houseguests approach the player over a stretch — relationship-driven, not
 * chance. An NPC's drive to seek the player is the stronger of their bond
 * (trust+affinity) or their threat read toward the player (both are real agendas:
 * allies want to scheme, rivals want to probe). A small per-moment temperature
 * roll modulates the ordering's intensity but cannot invert a clear relationship
 * gap — so the same seed reproduces the same approaches, and stronger ties
 * approach more.
 */
export function rankApproaches(
  player: EntityId,
  npcs: EntityId[],
  rel: RelationshipModel,
  rng: RandomnessSource,
  /** The 0028 per-variable INITIATIVE weight (audit E53): the bounded ordering-variance band. */
  initiativeWeight: number = TEMPERATURE_CONSTANTS.variableWeights.initiative,
): Approach[] {
  return npcs
    .filter((n) => n !== player)
    .map((n) => {
      const e = rel.edge(n, player);
      const bond = (e.trust + e.affinity) / 2;
      const agenda = Math.max(bond, e.threat);
      // Bounded: 1 ± initiative/2 — modulates intensity, never flips a clear gap at the default.
      const temper = 1 + (rng.next() - 0.5) * initiativeWeight;
      return { npc: n, drive: agenda * temper, motive: (bond >= e.threat ? "bond" : "probe") as ApproachMotive };
    })
    .sort((a, b) => b.drive - a.drive);
}

/** The NPCs who actually initiate this stretch — the top `count` by drive. */
export function npcInitiatedApproaches(
  player: EntityId,
  npcs: EntityId[],
  rel: RelationshipModel,
  rng: RandomnessSource,
  count = 3,
): EntityId[] {
  return rankApproaches(player, npcs, rel, rng).slice(0, Math.max(0, count)).map((a) => a.npc);
}

export type Expression =
  | { mode: "assert"; content: string }
  | { mode: "suspect"; content: string }
  | { mode: "silent" };

/** True only if the NPC legitimately knows the fact (witnessed-telling or surfaced). */
export function npcCanAssert(fact: Claimable, npcKnowledge: readonly Claimable[]): boolean {
  return npcKnowledge.some((k) => k.content === fact.content);
}

/**
 * What an NPC may say about a fact, constrained by what it legitimately knows
 * (0002). It ASSERTS only knowledge; for a mere hunch it SUSPECTS (hedged); with
 * no pathway at all it stays SILENT. It can never assert a fact it doesn't know —
 * the model cannot voice what the character was never given.
 */
export function npcExpress(
  fact: Claimable,
  npcKnowledge: readonly Claimable[],
  npcSuspicions: readonly Claimable[] = [],
): Expression {
  if (npcCanAssert(fact, npcKnowledge)) return { mode: "assert", content: fact.content };
  if (npcSuspicions.some((s) => s.content === fact.content)) {
    return { mode: "suspect", content: `I can't prove it, but I get the feeling ${fact.content}` };
  }
  return { mode: "silent" };
}
