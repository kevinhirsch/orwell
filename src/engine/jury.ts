import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { tallyJury } from "./season";

/**
 * Jury & endgame (feature 0014) — the finale. PURE and engine-owned: the engine
 * DECIDES every vote from accumulated jury relationships ("jury management") plus
 * the finale performance; the LLM only voices jurors and never changes a vote
 * (anti-sycophancy). Jury management is the dominant term — how the player treated
 * people on the way out is what mostly decides the finale; a strong/weak finale
 * sways close jurors but rarely overturns a clear lead.
 *
 * The tally + last-evicted-juror tie-break reuse `season.tallyJury` (0005 rule).
 */

/** A juror's directed read of a finalist at eviction (decision 0002 signals). */
export interface JuryRel {
  trust: number;
  affinity: number;
  threat: number;
}

/** How the finalist treated this juror on the way out — the manner of eviction. */
export interface EvictionManner {
  respected?: boolean;
  blindsided?: boolean;
  betrayed?: boolean;
  disrespected?: boolean;
}

export interface JuryWeights {
  relationship: number;
  manner: number;
  /** Deliberately small vs relationship+manner: the finale sways, it doesn't dominate. */
  finale: number;
}

export const JURY_WEIGHTS: JuryWeights = { relationship: 1.0, manner: 0.8, finale: 0.3 };

/**
 * A juror's lean toward a finalist: relationship (trust+affinity, less threat) plus
 * the manner of eviction. Blindsided / betrayed / disrespected pulls the lean down
 * (less likely to vote for the responsible finalist); feeling respected lifts it.
 */
export function juryLean(rel: JuryRel, manner: EvictionManner = {}, w: JuryWeights = JURY_WEIGHTS): number {
  const relationship = (rel.trust + rel.affinity) / 2 - 0.5 * rel.threat;
  const manners =
    (manner.respected ? 0.4 : 0) -
    (manner.blindsided ? 0.5 : 0) -
    (manner.betrayed ? 0.6 : 0) -
    (manner.disrespected ? 0.4 : 0);
  return w.relationship * relationship + w.manner * manners;
}

/** Finale performance in [0,1] — mean quality of the opening statement + answers. */
export function finalePerformance(parts: ReadonlyArray<{ quality: number }>): number {
  if (parts.length === 0) return 0.5;
  return parts.reduce((s, p) => s + Math.max(0, Math.min(1, p.quality)), 0) / parts.length;
}

/**
 * One juror's engine-decided vote between the two finalists. The dominant term is
 * the accumulated lean; the finale adds a small swing (performance + a momentary
 * seeded sway) that can tip a close juror but not a clear lead.
 */
export function castJuryVote(
  finalists: [EntityId, EntityId],
  leanFor: (f: EntityId) => number,
  perfFor: (f: EntityId) => number,
  rng: RandomnessSource,
  w: JuryWeights = JURY_WEIGHTS,
): EntityId {
  const sway = (f: EntityId): number => leanFor(f) + w.finale * (perfFor(f) + (rng.next() - 0.5));
  return sway(finalists[0]) >= sway(finalists[1]) ? finalists[0] : finalists[1];
}

/**
 * Tally the jury vote: each juror votes ONCE (precomputed so the tally and the
 * tie-break agree), most votes wins, a tie breaks to the last-evicted juror's vote.
 */
export function tallyJuryVote(
  jury: EntityId[],
  finalists: [EntityId, EntityId],
  leanOf: (juror: EntityId, finalist: EntityId) => number,
  perfOf: (finalist: EntityId) => number,
  juryEvictionOrder: EntityId[],
  rng: RandomnessSource,
  w: JuryWeights = JURY_WEIGHTS,
): EntityId {
  const votes = new Map<EntityId, EntityId>();
  for (const j of jury) votes.set(j, castJuryVote(finalists, (f) => leanOf(j, f), perfOf, rng, w));
  return tallyJury(jury, finalists, (j) => votes.get(j)!, juryEvictionOrder);
}

// --- Final 2 choreography -----------------------------------------------------

export interface FinaleScript {
  /** One opening statement slot per finalist. */
  statements: EntityId[];
  /** One question per juror, addressed to a finalist; the player answers (0012). */
  questions: Array<{ juror: EntityId; finalist: EntityId }>;
  /** The order votes are revealed in — one at a time, for drama. */
  revealOrder: EntityId[];
}

/**
 * The engine-produced finale choreography: a statement slot per finalist, one
 * question per juror (alternating which finalist is addressed), and a one-at-a-time
 * reveal order. The narrative layer voices each beat; it produces no decisions.
 */
export function runFinale(finalists: [EntityId, EntityId], jury: EntityId[]): FinaleScript {
  return {
    statements: [finalists[0], finalists[1]],
    questions: jury.map((juror, i) => ({ juror, finalist: finalists[i % 2]! })),
    revealOrder: [...jury],
  };
}
