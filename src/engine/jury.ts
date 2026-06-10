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
 * The structured appeal a finalist makes when answering a juror (feature 0037). This is the
 * ANTI-SYCOPHANCY crux: the finale sway comes from a finalist's CHOICE of appeal scored by the
 * engine against THAT juror's state — never from the LLM grading the eloquence of prose. The LLM
 * voices the exchange; the number below is the engine's.
 */
export type FinaleAppeal = "own-game" | "mend" | "connect" | "discredit-rival";

export const FINALE_APPEALS: readonly FinaleAppeal[] = ["own-game", "mend", "connect", "discredit-rival"];

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Engine-scored quality in [0,1] of `appeal` made to a juror with this read/manner of the finalist:
 *  - `mend`            lands only where there is a grievance (blindside/betrayal/disrespect) to address.
 *  - `connect`         scales with the juror's affinity for the finalist.
 *  - `own-game`        lands with jurors who respect a threatening, fair game; backfires on the betrayed.
 *  - `discredit-rival` a small generic lift that backfires with a juror loyal (high-affinity) to the rival.
 * The overall sway stays bounded by `JURY_WEIGHTS.finale` (well below relationship+manner), so a strong
 * finale tips CLOSE jurors and never overturns a clear lead.
 */
export function appealEffect(appeal: FinaleAppeal, rel: JuryRel, manner: EvictionManner = {}): number {
  const grievance = !!(manner.blindsided || manner.betrayed || manner.disrespected);
  switch (appeal) {
    case "mend":
      return grievance ? 0.85 : 0.35;
    case "connect":
      return clamp01(0.4 + 0.4 * rel.affinity);
    case "own-game":
      return manner.betrayed ? 0.3 : clamp01(0.55 + 0.2 * rel.threat);
    case "discredit-rival":
      return rel.affinity > 0.6 ? 0.35 : 0.55;
  }
}

/**
 * The finale performance a finalist contributes to a juror who NEVER questioned them (audit A6).
 * A NEUTRAL 0.5 — neither the optimal `bestAppeal` (which would let the engine silently play an
 * unanswered finalist's finale for them — sycophancy, and asymmetric when only the player was
 * back-filled optimally) nor a penalty. Applied SYMMETRICALLY to the player and NPC finalists, so an
 * unasked (finalist, juror) slot sways that juror neither way; a finalist only earns finale sway
 * from the jurors who actually questioned them.
 */
export const NEUTRAL_APPEAL_EFFECT = 0.5;

/**
 * The strongest appeal a finalist can make to a given juror — used to let an NPC finalist play the
 * finale optimally (deterministic argmax over `FINALE_APPEALS`, ties broken by declaration order), so
 * the player's own appeals have to be at least as good to gain ground.
 */
export function bestAppeal(rel: JuryRel, manner: EvictionManner = {}): FinaleAppeal {
  let best: FinaleAppeal = FINALE_APPEALS[0]!;
  let bestScore = -Infinity;
  for (const a of FINALE_APPEALS) {
    const s = appealEffect(a, rel, manner);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
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
