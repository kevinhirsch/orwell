import type { EntityId } from "../domain/ids";
import { RelationshipModel } from "./relationships";

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

/** How hard a rattled HOH's paranoia bends the nomination read toward whoever they least trust. */
export const NOMINATION_PARANOIA_WEIGHT = 0.5;

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
  const paranoia = Math.max(0, (0.5 - mood) * 2); // 0 when calm … 1 when fully rattled
  if (paranoia === 0) return chooseNominations(hoh, active, rel);
  const score = (t: EntityId): number =>
    rel.edge(hoh, t).threat + paranoia * NOMINATION_PARANOIA_WEIGHT * (1 - rel.edge(hoh, t).trust);
  const ranked = active.filter((h) => h !== hoh).sort((a, b) => score(b) - score(a));
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
