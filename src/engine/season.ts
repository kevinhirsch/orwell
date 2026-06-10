import type { EntityId } from "../domain/ids";
import { RelationshipModel } from "./relationships";
import { blocFor, blocTerm } from "./blocs";
import type { Bloc } from "./blocs";
import { DECISION } from "./decisionConstants";
import type { NominationTactic } from "./decisionConstants";
import type { RelationshipDisposition } from "./relationshipConstants";

/**
 * Shared season primitives (feature 0011). The weekly loop itself lives in `liveSeason.ts` — the
 * ONE rulebook the live game runs; the seed-deterministic calibration driver over it lives in
 * `calibration.ts` (B55/audit D12: the old parallel `playSeason` sim diverged in rules from the
 * game the player actually plays, so its duplicate decision helpers are gone). What remains here
 * are the pure, relationship-driven decision reads BOTH consume.
 */
export interface Stats {
  physical: number;
  mental: number;
  social: number;
}
export interface SeasonHouseguest {
  id: EntityId;
  stats: Stats;
}

/** Top-2 threats from the HOH's perspective — relationship-driven nominations. */
export function chooseNominations(hoh: EntityId, active: EntityId[], rel: RelationshipModel): [EntityId, EntityId] {
  const ranked = active.filter((h) => h !== hoh).sort((a, b) => rel.edge(hoh, b).threat - rel.edge(hoh, a).threat);
  return [ranked[0]!, ranked[1]!];
}

/** How hard a rattled HOH's paranoia bends the nomination read toward whoever they least trust.
 *  Re-homed into the 0044 constants module (the single tunable sibling of 0026/0028). */
export const NOMINATION_PARANOIA_WEIGHT = DECISION.nomination.paranoiaWeight;

/**
 * Mood-aware nominations (feature 0041): a CALM HOH (emotionalState ≥ baseline 0.5) ranks purely by
 * threat — byte-identical to `chooseNominations`. A RATTLED HOH (emotionalState < 0.5) adds a
 * bounded paranoia term that over-weights whoever they least trust, so the season's emotional arc
 * bends their decisions (they nominate more erratically). The hard rules still hold downstream
 * (the HOH is excluded; two distinct nominees) — emotion never overrides legality (0005).
 */
export function chooseNominationsWithMood(
  hoh: EntityId, active: EntityId[], rel: RelationshipModel, mood: number,
): [EntityId, EntityId] {
  if (Math.max(0, (0.5 - mood) * 2) === 0) return chooseNominations(hoh, active, rel);
  const ranked = active.filter((h) => h !== hoh)
    .sort((a, b) => nominationScore(hoh, b, rel, mood) - nominationScore(hoh, a, rel, mood));
  return [ranked[0]!, ranked[1]!];
}

/**
 * The HOH's raw nomination leaning toward one target: threat + the rattled-paranoia term (0041).
 * Exposed so layered reads (the 0043 bloc term) can ADD to the same base instead of forking it.
 */
export function nominationScore(hoh: EntityId, target: EntityId, rel: RelationshipModel, mood: number): number {
  const paranoia = Math.max(0, (0.5 - mood) * 2); // 0 when calm … 1 when fully rattled
  return rel.edge(hoh, target).threat + paranoia * NOMINATION_PARANOIA_WEIGHT * (1 - rel.edge(hoh, target).trust);
}

/**
 * The week's POLITICAL TEMPERATURE (0044): how lopsided the house-wide threat distribution is.
 * Each houseguest's menace is the MEAN threat the rest of the house reads in them; the spread is
 * the gap between the scariest read and the median. A big gap ⇒ a runaway threat ⇒ a "hot" week
 * where every HOH plays direct; a flat distribution ⇒ a quiet week that frees the tactical games.
 */
export function politicalTemperature(active: readonly EntityId[], rel: RelationshipModel): { spread: number; runaway: boolean } {
  const menace = (id: EntityId): number => {
    const readers = active.filter((x) => x !== id);
    if (readers.length === 0) return 0;
    return readers.reduce((sum, r) => sum + rel.edge(r, id).threat, 0) / readers.length;
  };
  const reads = active.map(menace).sort((a, b) => a - b);
  if (reads.length === 0) return { spread: 0, runaway: false };
  const median = reads[Math.floor(reads.length / 2)]!;
  const spread = reads[reads.length - 1]! - median;
  return { spread, runaway: spread > DECISION.nomination.runawaySpread };
}

/** The signals the strategic nomination read consumes — all optional so it degrades to threat-only. */
export interface NominationRead {
  /** The house's current derived blocs (0043) — bloc-mates are shielded from the block. */
  blocs?: readonly Bloc[];
  /** The HOH's live soul emotional state (0041); rattled ⇒ the paranoia term bends the ranking. */
  mood?: number;
  /** The HOH's static disposition — gates WHICH tactic they play (a loyalist ≠ a schemer). */
  disposition?: RelationshipDisposition;
}

/**
 * Strategic nominations (feature 0044): the blended, archetype-gated read layered on the built
 * threat-primary ranking. Threat still dominates WHO the target is — but the PAIR reflects a
 * tactic: a loyalist sits a low-read PAWN beside the target; a schemer leaves the real target off
 * the block as a BACKDOOR plan (the veto bait goes up; the replacement read completes it); a hot
 * week (a runaway threat, `politicalTemperature`) forces everyone DIRECT. Bloc-mates are never
 * nominated while two legal others remain (0043). Deterministic: no rng — every input is a
 * computed hidden signal, so the same seed's signals yield the same pair (anti-sycophancy: the
 * engine decides, the narrator only voices it). Legality (0005) still binds downstream.
 */
export function nominationStrategy(
  hoh: EntityId, active: EntityId[], rel: RelationshipModel, read: NominationRead = {},
): [EntityId, EntityId] {
  const { blocs = [], mood = 0.5, disposition = "neutral" } = read;
  let cands = active.filter((h) => h !== hoh);
  // Bloc protection (0043): keep bloc-mates off the block entirely while two legal others remain.
  const mates = blocFor(blocs, hoh)?.members ?? [];
  const nonMates = cands.filter((c) => !mates.includes(c));
  if (nonMates.length >= 2) cands = nonMates;
  const score = (t: EntityId): number => nominationScore(hoh, t, rel, mood) + blocTerm(blocs, hoh, t);
  const ranked = [...cands].sort((a, b) => score(b) - score(a));
  const tactic: NominationTactic = politicalTemperature(active, rel).runaway
    ? "direct" // a runaway threat ends the tactical games — the house moves on them now
    : DECISION.nomination.tacticFor[disposition];
  if (tactic === "backdoor" && ranked.length >= 3) return [ranked[1]!, ranked[2]!];
  if (tactic === "pawn" && ranked.length >= 3) return [ranked[0]!, ranked[ranked.length - 1]!];
  return [ranked[0]!, ranked[1]!];
}

/** Tally a jury vote: most votes wins; a tie is broken by the last-evicted juror. */
export function tallyJury(
  jurors: EntityId[],
  finalTwo: [EntityId, EntityId],
  votesFor: (juror: EntityId) => EntityId,
  juryEvictionOrder: EntityId[],
): EntityId {
  const tally: Record<EntityId, number> = { [finalTwo[0]]: 0, [finalTwo[1]]: 0 };
  for (const j of jurors) tally[votesFor(j)] = (tally[votesFor(j)] ?? 0) + 1;
  if (tally[finalTwo[0]]! > tally[finalTwo[1]]!) return finalTwo[0];
  if (tally[finalTwo[1]]! > tally[finalTwo[0]]!) return finalTwo[1];
  const lastJuror = [...juryEvictionOrder].reverse().find((e) => jurors.includes(e))!;
  return votesFor(lastJuror);
}
