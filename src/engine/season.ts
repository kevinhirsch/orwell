import type { EntityId } from "../domain/ids";
import { PLAYER } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import {
  eligibleForHOH, vetoParticipants, selectableReplacements, evictionVoters,
} from "../domain/eligibility";
import type { WeekState } from "../domain/eligibility";
import { resolveCompetition, CompetitionIntents } from "../domain/competitionOutcome";
import type { CompetitionType } from "../domain/competitionOutcome";
import { RelationshipModel } from "./relationships";

/**
 * The weekly-loop orchestrator (feature 0011) — the gameplay spine. PURE,
 * seed-deterministic: it binds the legality rules (0005), competition outcomes
 * (0006), and the relationship model (decision 0002) into a playable week and a
 * full season down to Final 2 + a jury vote. NPC decisions are relationship-
 * driven (threat/trust), never random.
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

export const WEEK_PHASES = [
  "hoh-competition", "nominations", "veto-competition", "veto-ceremony", "eviction-vote", "live-eviction",
] as const;

export interface WeekRecord {
  week: number;
  hoh: EntityId;
  nominees: [EntityId, EntityId];
  vetoHolder: EntityId;
  vetoUsed: boolean;
  replacement?: EntityId;
  finalNominees: [EntityId, EntityId];
  evictee: EntityId;
}

export interface SeasonOutcome {
  winner: EntityId;
  finalTwo: [EntityId, EntityId];
  evictionOrder: EntityId[];
  jury: EntityId[];
  preJury: EntityId[];
  weeks: WeekRecord[];
}

const COMP_TYPES: readonly CompetitionType[] = ["endurance", "puzzle", "social"];

function seedRelationships(ids: EntityId[], rng: RandomnessSource): RelationshipModel {
  const rel = new RelationshipModel(0.5);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const e = rel.edge(a, b);
      e.trust = rng.next();
      e.affinity = rng.next();
      e.threat = rng.next();
      e.confidence = 0.5;
    }
  }
  return rel;
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

function competitorsOf(ids: EntityId[], statsOf: Map<EntityId, Stats>) {
  return ids.map((id) => ({ id, stats: statsOf.get(id)!, emotionalState: 0.5 }));
}

function winnerOf(ids: EntityId[], type: CompetitionType, statsOf: Map<EntityId, Stats>, rng: RandomnessSource): EntityId {
  return resolveCompetition(competitorsOf(ids, statsOf), type, new CompetitionIntents(), rng).winner;
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

export function playSeason(opts: { seed: number; houseguests: SeasonHouseguest[]; player?: EntityId }): SeasonOutcome {
  const rng = new SeededRandom(opts.seed);
  const player = opts.player ?? PLAYER;
  const statsOf = new Map(opts.houseguests.map((h) => [h.id, h.stats]));
  let active = opts.houseguests.map((h) => h.id);
  const rel = seedRelationships(active, rng);

  const evictionOrder: EntityId[] = [];
  const weeks: WeekRecord[] = [];
  let outgoingHoh: EntityId | undefined;

  while (active.length > 2) {
    const week = weeks.length;
    const type = COMP_TYPES[week % COMP_TYPES.length]!;

    const hoh = winnerOf(eligibleForHOH({ houseguests: active, player, hoh: active[0]!, nominees: [active[0]!, active[1]!], ...(outgoingHoh ? { outgoingHoh } : {}) }), type, statsOf, rng);
    const nominees = chooseNominations(hoh, active, rel);

    const ws: WeekState = { houseguests: active, player, hoh, nominees };
    const vetoHolder = winnerOf(vetoParticipants(ws, rng).participants, COMP_TYPES[(week + 1) % COMP_TYPES.length]!, statsOf, rng);

    // Veto ceremony: holder saves themselves, or a strongly-trusted nominee.
    let vetoUsed = false;
    let replacement: EntityId | undefined;
    let finalNominees: [EntityId, EntityId] = [nominees[0], nominees[1]];
    const saved = nominees.includes(vetoHolder)
      ? vetoHolder
      : nominees.find((n) => rel.edge(vetoHolder, n).trust > 0.6);
    if (saved) {
      vetoUsed = true;
      const selectable = selectableReplacements({ ...ws, vetoWinner: vetoHolder });
      replacement = selectable
        .filter((h) => h !== saved)
        .sort((a, b) => rel.edge(hoh, b).threat - rel.edge(hoh, a).threat)[0]!;
      finalNominees = [nominees.find((n) => n !== saved)!, replacement];
    }

    // Eviction vote: everyone but HOH + final nominees; HOH breaks ties.
    const wsFinal: WeekState = { houseguests: active, player, hoh, nominees: finalNominees, vetoWinner: vetoHolder };
    const voters = evictionVoters(wsFinal);
    const evicteeOf = (voter: EntityId): EntityId =>
      rel.edge(voter, finalNominees[0]).threat >= rel.edge(voter, finalNominees[1]).threat ? finalNominees[0] : finalNominees[1];
    const votes: Record<EntityId, number> = { [finalNominees[0]]: 0, [finalNominees[1]]: 0 };
    for (const v of voters) votes[evicteeOf(v)]++;
    let evictee: EntityId;
    if (votes[finalNominees[0]]! > votes[finalNominees[1]]!) evictee = finalNominees[0];
    else if (votes[finalNominees[1]]! > votes[finalNominees[0]]!) evictee = finalNominees[1];
    else evictee = evicteeOf(hoh); // HOH breaks the tie

    evictionOrder.push(evictee);
    active = active.filter((h) => h !== evictee);
    outgoingHoh = hoh;
    weeks.push({ week, hoh, nominees, vetoHolder, vetoUsed, ...(replacement ? { replacement } : {}), finalNominees, evictee });
  }

  const finalTwo: [EntityId, EntityId] = [active[0]!, active[1]!];
  const jury = evictionOrder.slice(-9);
  const preJury = evictionOrder.slice(0, Math.max(0, evictionOrder.length - 9));
  const winner = tallyJury(
    jury,
    finalTwo,
    (juror) => (rel.edge(juror, finalTwo[0]).trust + rel.edge(juror, finalTwo[0]).affinity >= rel.edge(juror, finalTwo[1]).trust + rel.edge(juror, finalTwo[1]).affinity ? finalTwo[0] : finalTwo[1]),
    evictionOrder,
  );

  return { winner, finalTwo, evictionOrder, jury, preJury, weeks };
}

// --- Player decision points (surfaced + validated) ----------------------------

export interface PendingDecision {
  kind: "nominations";
  by: EntityId;
  options: EntityId[];
  pick: number;
}

export function pendingNominationDecision(state: { active: EntityId[]; hoh: EntityId }): PendingDecision {
  return { kind: "nominations", by: state.hoh, options: state.active.filter((h) => h !== state.hoh), pick: 2 };
}

export function validateNominations(state: { active: EntityId[]; hoh: EntityId }, choice: EntityId[]): void {
  const legal = new Set(state.active.filter((h) => h !== state.hoh));
  if (choice.length !== 2) throw new Error("must nominate exactly two");
  if (choice[0] === choice[1]) throw new Error("cannot nominate the same houseguest twice");
  for (const c of choice) if (!legal.has(c)) throw new Error(`illegal nominee: ${c}`);
}
