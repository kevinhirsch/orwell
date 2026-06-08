import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { resolveCompetition, CompetitionIntents } from "../domain/competitionOutcome";
import type { CompetitionType } from "../domain/competitionOutcome";
import {
  eligibleForHOH, vetoParticipants, selectableReplacements, evictionVoters,
} from "../domain/eligibility";
import type { WeekState } from "../domain/eligibility";
import type { Stats } from "./season";
import { chooseNominations, tallyJury } from "./season";
import type { RelationshipModel } from "./relationships";

/**
 * The LIVE weekly loop (feature 0011, wired into the running game). Unlike
 * `playSeason` — a one-shot pure simulation used for outcome tests — this advances
 * the season ONE beat at a time so the player can live inside it, and PAUSES at the
 * player's own decision points (nominate, use the veto, name a replacement, cast an
 * eviction vote). It is pure and seed-deterministic: NPC choices are
 * relationship-driven (threat/trust), competitions are engine-decided (the player
 * is never protected — anti-sycophancy), and the legality rules (0005) are reused
 * verbatim from `domain/eligibility`. The Vault never enters here.
 */
export type Beat =
  | "hoh-competition" | "nominations" | "veto-competition"
  | "veto-ceremony" | "eviction" | "finale" | "complete";

/** A player decision the live loop is blocked on until `applyDecision` resolves it. */
export type PendingDecision =
  | { kind: "nominations"; by: EntityId; options: EntityId[]; pick: 2 }
  | { kind: "veto-decision"; by: EntityId; nominees: [EntityId, EntityId]; saveable: EntityId[] }
  | { kind: "replacement"; by: EntityId; saved: EntityId; options: EntityId[] }
  | { kind: "eviction-vote"; by: EntityId; nominees: [EntityId, EntityId] };

export interface LiveSeasonState {
  week: number;                 // 1-based HOH reign
  beat: Beat;                   // the next beat to resolve
  active: EntityId[];
  hoh?: EntityId;
  nominees?: [EntityId, EntityId];
  vetoField?: EntityId[];
  vetoHolder?: EntityId;
  vetoUsed: boolean;
  saved?: EntityId;
  replacement?: EntityId;
  finalNominees?: [EntityId, EntityId];
  outgoingHoh?: EntityId;
  evictionOrder: EntityId[];
  evictee?: EntityId;
  finished: boolean;
  winner?: EntityId;
  finalTwo?: [EntityId, EntityId];
  jury?: EntityId[];
  pending?: PendingDecision;
}

/** What the live loop reads about the house — kept narrow so the core stays pure/testable. */
export interface SeasonCtx {
  player: EntityId;
  statsOf: (id: EntityId) => Stats;
  rel: RelationshipModel;
}

/** A meaningful, player-witnessed beat event (daily-event invariant, 0008). */
export interface BeatEvent {
  beat: Beat;
  content: string;
  participants: EntityId[];
}

export type DecisionInput =
  | { kind: "nominations"; choice: [EntityId, EntityId] }
  | { kind: "veto-decision"; use: boolean; save?: EntityId }
  | { kind: "replacement"; replacement: EntityId }
  | { kind: "eviction-vote"; vote: EntityId };

const HOH_TYPES: readonly CompetitionType[] = ["endurance", "mental", "physical"];
const VETO_TYPES: readonly CompetitionType[] = ["puzzle", "social", "memory"];

export function newLiveSeason(active: EntityId[]): LiveSeasonState {
  return {
    week: 1, beat: active.length > 2 ? "hoh-competition" : "finale",
    active: [...active], vetoUsed: false, evictionOrder: [], finished: false,
  };
}

function winnerOf(ids: EntityId[], type: CompetitionType, ctx: SeasonCtx, rng: RandomnessSource): EntityId {
  const competitors = ids.map((id) => ({ id, stats: ctx.statsOf(id), emotionalState: 0.5 }));
  return resolveCompetition(competitors, type, new CompetitionIntents(), rng).winner;
}

/** A throwaway WeekState for the legality helpers (they only read the fields they need). */
function weekState(s: LiveSeasonState, ctx: SeasonCtx): WeekState {
  const noms = s.nominees ?? [s.active[0]!, s.active[1]!];
  return {
    houseguests: s.active, player: ctx.player, hoh: s.hoh ?? s.active[0]!,
    nominees: noms, ...(s.outgoingHoh ? { outgoingHoh: s.outgoingHoh } : {}),
    ...(s.vetoHolder ? { vetoWinner: s.vetoHolder } : {}),
  };
}

/** Replacement nominees the HOH may name after a save (excludes HOH, noms, veto winner, the saved). */
function replacementOptions(s: LiveSeasonState, ctx: SeasonCtx): EntityId[] {
  return selectableReplacements(weekState(s, ctx)).filter((h) => h !== s.saved);
}

function otherNominee(s: LiveSeasonState): EntityId {
  return s.nominees!.find((n) => n !== s.saved)!;
}

/** Resolve the eviction once a final vote target exists for the player (or none if NPC-only). */
function tallyEviction(s: LiveSeasonState, ctx: SeasonCtx, playerVote?: EntityId): EntityId {
  const fn = s.finalNominees!;
  const voters = evictionVoters({ ...weekState(s, ctx), nominees: fn });
  const npcChoice = (voter: EntityId): EntityId =>
    ctx.rel.edge(voter, fn[0]).threat >= ctx.rel.edge(voter, fn[1]).threat ? fn[0] : fn[1];
  const votes: Record<EntityId, number> = { [fn[0]]: 0, [fn[1]]: 0 };
  for (const v of voters) votes[v === ctx.player && playerVote ? playerVote : npcChoice(v)]++;
  if (votes[fn[0]]! > votes[fn[1]]!) return fn[0];
  if (votes[fn[1]]! > votes[fn[0]]!) return fn[1];
  return npcChoice(s.hoh!); // HOH breaks the tie
}

/** Remove the evictee and roll into the next week (or the finale at Final 3 → 2). */
function applyEviction(s: LiveSeasonState, evictee: EntityId): void {
  s.evictee = evictee;
  s.evictionOrder.push(evictee);
  s.active = s.active.filter((h) => h !== evictee);
  s.outgoingHoh = s.hoh;
  s.hoh = undefined; s.nominees = undefined; s.vetoField = undefined;
  s.vetoHolder = undefined; s.vetoUsed = false; s.saved = undefined;
  s.replacement = undefined; s.finalNominees = undefined;
  if (s.active.length <= 2) {
    s.beat = "finale";
  } else {
    s.week += 1; s.beat = "hoh-competition";
  }
}

function runFinale(s: LiveSeasonState, ctx: SeasonCtx): BeatEvent {
  const finalTwo: [EntityId, EntityId] = [s.active[0]!, s.active[1]!];
  const jury = s.evictionOrder.slice(-9);
  const winner = tallyJury(
    jury, finalTwo,
    (juror) =>
      ctx.rel.edge(juror, finalTwo[0]).trust + ctx.rel.edge(juror, finalTwo[0]).affinity >=
      ctx.rel.edge(juror, finalTwo[1]).trust + ctx.rel.edge(juror, finalTwo[1]).affinity
        ? finalTwo[0] : finalTwo[1],
    s.evictionOrder,
  );
  s.finalTwo = finalTwo; s.jury = jury; s.winner = winner; s.finished = true; s.beat = "complete";
  return { beat: "finale", content: `${winner} wins the season over ${finalTwo.find((f) => f !== winner)}`, participants: finalTwo };
}

/**
 * Advance one beat. Returns the meaningful event produced, or `null` if the loop is
 * blocked on a player decision (`state.pending` is set) or already complete.
 */
export function advance(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent | null {
  if (s.pending || s.finished || s.beat === "complete") return null;

  switch (s.beat) {
    case "hoh-competition": {
      const ws = weekState(s, ctx);
      const hoh = winnerOf(eligibleForHOH(ws), HOH_TYPES[(s.week - 1) % HOH_TYPES.length]!, ctx, rng);
      s.hoh = hoh; s.beat = "nominations";
      return { beat: "hoh-competition", content: `${hoh} wins Head of Household`, participants: [hoh] };
    }
    case "nominations": {
      if (s.hoh === ctx.player) {
        s.pending = { kind: "nominations", by: ctx.player, options: s.active.filter((h) => h !== ctx.player), pick: 2 };
        return null;
      }
      const nominees = chooseNominations(s.hoh!, s.active, ctx.rel);
      s.nominees = nominees; s.beat = "veto-competition";
      return { beat: "nominations", content: `${s.hoh} nominates ${nominees[0]} and ${nominees[1]}`, participants: [s.hoh!, ...nominees] };
    }
    case "veto-competition": {
      const field = vetoParticipants(weekState(s, ctx), rng, {
        houseguestsChoiceChip: true,
        choose: (holder, cands) => ctx.rel.chooseStrongestBond(holder, cands, rng),
      }).participants;
      const holder = winnerOf(field, VETO_TYPES[(s.week - 1) % VETO_TYPES.length]!, ctx, rng);
      s.vetoField = field; s.vetoHolder = holder; s.beat = "veto-ceremony";
      return { beat: "veto-competition", content: `${holder} wins the Power of Veto`, participants: field };
    }
    case "veto-ceremony": {
      const nominees = s.nominees!;
      if (s.vetoHolder === ctx.player) {
        const saveable = nominees.filter(() => true); // the holder may save either nominee (incl. self if nominated)
        s.pending = { kind: "veto-decision", by: ctx.player, nominees, saveable };
        return null;
      }
      // NPC veto holder: save self if nominated, else a strongly-trusted nominee.
      const saved = nominees.includes(s.vetoHolder!)
        ? s.vetoHolder!
        : nominees.find((n) => ctx.rel.edge(s.vetoHolder!, n).trust > 0.6);
      if (!saved) {
        s.vetoUsed = false; s.finalNominees = [nominees[0], nominees[1]]; s.beat = "eviction";
        return { beat: "veto-ceremony", content: `${s.vetoHolder} does not use the veto`, participants: [s.vetoHolder!] };
      }
      s.vetoUsed = true; s.saved = saved;
      return resolveReplacement(s, ctx); // either pends on the player-HOH or NPC-picks, then → eviction
    }
    case "eviction": {
      const fn = s.finalNominees!;
      const voters = evictionVoters({ ...weekState(s, ctx), nominees: fn });
      if (voters.includes(ctx.player)) {
        s.pending = { kind: "eviction-vote", by: ctx.player, nominees: fn };
        return null;
      }
      const evictee = tallyEviction(s, ctx);
      const ev: BeatEvent = { beat: "eviction", content: `${evictee} is evicted`, participants: [evictee] };
      applyEviction(s, evictee);
      return ev;
    }
    case "finale":
      return runFinale(s, ctx);
    default:
      return null;
  }
}

/** After a veto save: the HOH names the replacement (player pends; NPC auto-picks). */
function resolveReplacement(s: LiveSeasonState, ctx: SeasonCtx): BeatEvent | null {
  const options = replacementOptions(s, ctx);
  if (options.length === 0) {
    // Final-4 edge: no legal replacement exists, so the veto cannot force one — it
    // resolves UNUSED and the original nominees stand (the holder is the sole voter).
    s.vetoUsed = false; s.saved = undefined; s.finalNominees = [s.nominees![0], s.nominees![1]]; s.beat = "eviction";
    return { beat: "veto-ceremony", content: `${s.vetoHolder} does not use the veto`, participants: [s.vetoHolder!] };
  }
  if (s.hoh === ctx.player) {
    s.pending = { kind: "replacement", by: ctx.player, saved: s.saved!, options };
    return null;
  }
  const replacement = [...options].sort((a, b) => ctx.rel.edge(s.hoh!, b).threat - ctx.rel.edge(s.hoh!, a).threat)[0]!;
  s.replacement = replacement; s.finalNominees = [otherNominee(s), replacement]; s.beat = "eviction";
  return {
    beat: "veto-ceremony",
    content: `${s.vetoHolder} uses the veto on ${s.saved}; ${s.hoh} names ${replacement} as the replacement`,
    participants: [s.vetoHolder!, s.saved!, s.hoh!, replacement],
  };
}

/** Apply the player's decision for the current `pending`, then continue to the next beat. */
export function applyDecision(s: LiveSeasonState, input: DecisionInput, ctx: SeasonCtx): BeatEvent {
  if (!s.pending || s.pending.kind !== input.kind) {
    throw new Error(`no pending ${input.kind} decision`);
  }
  switch (input.kind) {
    case "nominations": {
      const legal = new Set(s.active.filter((h) => h !== s.hoh));
      const [a, b] = input.choice;
      if (a === b) throw new Error("cannot nominate the same houseguest twice");
      if (!legal.has(a) || !legal.has(b)) throw new Error("illegal nominee");
      s.nominees = [a, b]; s.pending = undefined; s.beat = "veto-competition";
      return { beat: "nominations", content: `${s.hoh} nominates ${a} and ${b}`, participants: [s.hoh!, a, b] };
    }
    case "veto-decision": {
      const nominees = s.nominees!;
      s.pending = undefined;
      if (!input.use) {
        s.vetoUsed = false; s.finalNominees = [nominees[0], nominees[1]]; s.beat = "eviction";
        return { beat: "veto-ceremony", content: `${ctx.player} does not use the veto`, participants: [ctx.player] };
      }
      const save = input.save;
      if (!save || !nominees.includes(save)) throw new Error("can only veto a current nominee");
      s.vetoUsed = true; s.saved = save;
      // The HOH names the replacement. If the player is ALSO HOH, that's the next decision.
      const ev = resolveReplacement(s, ctx);
      return ev ?? { beat: "veto-ceremony", content: `${ctx.player} uses the veto on ${save}`, participants: [ctx.player, save] };
    }
    case "replacement": {
      const legal = new Set(selectableReplacements(weekState(s, ctx)).filter((h) => h !== s.saved));
      if (!legal.has(input.replacement)) throw new Error("illegal replacement nominee");
      s.replacement = input.replacement; s.finalNominees = [otherNominee(s), input.replacement];
      s.pending = undefined; s.beat = "eviction";
      return { beat: "veto-ceremony", content: `${s.hoh} names ${input.replacement} as the replacement`, participants: [s.hoh!, input.replacement] };
    }
    case "eviction-vote": {
      const fn = s.finalNominees!;
      if (!fn.includes(input.vote)) throw new Error("can only vote to evict a final nominee");
      s.pending = undefined;
      const evictee = tallyEviction(s, ctx, input.vote);
      const ev: BeatEvent = { beat: "eviction", content: `${evictee} is evicted`, participants: [evictee] };
      applyEviction(s, evictee);
      return ev;
    }
  }
}
