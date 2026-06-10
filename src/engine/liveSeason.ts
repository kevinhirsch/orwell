import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { resolveCompetition, CompetitionIntents } from "../domain/competitionOutcome";
import type { CompetitionType, Intent } from "../domain/competitionOutcome";

/** The competition intents the player may declare (Bible: compete / throw / play-safe), 0006/0034. */
export const COMP_INTENTS: readonly Intent[] = ["compete", "throw", "play-safe"];
import {
  eligibleForHOH, vetoParticipants, selectableReplacements, evictionVoters,
} from "../domain/eligibility";
import type { WeekState } from "../domain/eligibility";
import type { Stats } from "./season";
import { nominationStrategy, nominationScore, tallyJury } from "./season";
import { detectBlocs, blocTerm } from "./blocs";
import type { Bloc } from "./blocs";
import { DECISION } from "./decisionConstants";
import type { Deal } from "../domain/deal";
import type { RelationshipDisposition } from "./relationshipConstants";
import type { RelationshipModel } from "./relationships";
import {
  runFinale as buildFinaleScript, castJuryVote, juryLean, appealEffect, bestAppeal,
  FINALE_APPEALS, type EvictionManner, type FinaleAppeal, type FinaleScript, type JuryRel,
} from "./jury";
import { MANNER_THRESHOLDS } from "./juryConstants";
import { RELATIONSHIP_CONSTANTS } from "./relationshipConstants";
import { maybeFireTwist } from "./reserveTwists";
import type { ReserveTwist, TwistEvent, TwistKind } from "./reserveTwists";
import { drawCompetition, competitionById } from "./competitionLibrary";
import type { CompetitionDef, CompetitionPhase } from "./competitionLibrary";

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
  | "veto-ceremony" | "eviction" | "final-eviction" | "finale" | "complete"
  // a sealed reserve twist firing (0025/B53): the production reveal that opens a twist night.
  | "twist-reveal"
  // finale sub-loop events (0037) — emitted on BeatEvent only; never a structural `s.beat`.
  | "finale-reveal" | "finale-result"
  // eviction sub-loop events (0047) — emitted on BeatEvent only; the staged reveal/goodbye/result.
  | "eviction-reveal" | "eviction-goodbye" | "eviction-result";

/** A player decision the live loop is blocked on until `applyDecision` resolves it. */
export type PendingDecision =
  | { kind: "nominations"; by: EntityId; options: EntityId[]; pick: 2 }
  | { kind: "veto-decision"; by: EntityId; nominees: [EntityId, EntityId]; saveable: EntityId[] }
  // --- competition intent (B46/audit B5): the player declares compete/throw/play-safe before a comp ---
  | { kind: "comp-intent"; by: EntityId; comp: "hoh-competition" | "veto-competition" }
  // --- "Houseguest's Choice" (0046/B45): the player drew the chip and picks the sixth veto player ---
  | { kind: "houseguests-choice"; by: EntityId; options: EntityId[] }
  | { kind: "replacement"; by: EntityId; saved: EntityId; options: EntityId[] }
  | { kind: "eviction-vote"; by: EntityId; nominees: [EntityId, EntityId] }
  // --- player-HOH tie-break (0046/B44): the player breaks a tied eviction vote ---
  | { kind: "tie-break"; by: EntityId; nominees: [EntityId, EntityId] }
  // --- Final 3 (0045): the final HOH personally evicts one of the other two ---
  | { kind: "final-eviction"; by: EntityId; options: [EntityId, EntityId] }
  // --- finale (0037) ---
  | { kind: "finale-statement"; by: EntityId }
  | { kind: "finale-answer"; by: EntityId; juror: EntityId; appeals: FinaleAppeal[] }
  | { kind: "juror-vote"; by: EntityId; finalists: [EntityId, EntityId] };

/** Which stage of the live finale sub-loop (0037) we are advancing. */
export type FinaleStage = "statements" | "questions" | "vote" | "reveal";

/**
 * The live finale sub-state machine (0037). Carries the engine's script plus the per-step
 * cursor and the recorded appeals, so the finale can pause for player decisions, resume after
 * a restart (0030), and reveal votes one at a time in agreement with a precomputed tally.
 * Vault-free by construction (ids only — no leans/tallies until reveal).
 */
export interface FinaleProgress {
  stage: FinaleStage;
  finalists: [EntityId, EntityId];
  jury: EntityId[];
  script: FinaleScript;
  /** Cursor into `script.statements` (statements stage). */
  statementIx: number;
  /** Cursor into `script.questions` (questions stage). */
  questionIx: number;
  /** The appeal each finalist made to each juror: appeals[finalist][juror]. */
  appeals: Record<EntityId, Record<EntityId, FinaleAppeal>>;
  /** Precomputed votes (juror → finalist) — set once at the start of the vote stage. */
  votes?: Record<EntityId, EntityId>;
  /** Cursor into `script.revealOrder` (reveal stage). */
  revealIx: number;
}

/** Which stage of the live eviction sub-loop (0047) we are advancing. */
export type EvictionStage = "votes" | "goodbye" | "result";

/**
 * The live eviction sub-state machine (0047): the weekly eviction staged like the finale (0037) —
 * the votes are revealed ONE AT A TIME in a seeded order (revealed-only tally), then an evictee
 * goodbye + goodbye messages whose tone folds into the evictee's manner (jury management, 0014).
 * The engine already decided the tally; this only choreographs the reveal. Vault-free by construction
 * (ids only; the evictee is not named until the last vote lands). Persisted + restart-safe (0030).
 */
export interface EvictionProgress {
  stage: EvictionStage;
  nominees: [EntityId, EntityId];
  /** The voters in the seeded order their votes are read. */
  revealOrder: EntityId[];
  /** Each voter's already-decided vote (voter → the nominee they voted to evict). */
  voteOf: Record<EntityId, EntityId>;
  /** Cursor into `revealOrder` (votes stage). */
  revealIx: number;
  /** The evicted houseguest — set only once the LAST vote is read (the tally + any HOH tie-break). */
  evictee?: EntityId;
  /** The seeded houseguests who leave a goodbye message, in order. */
  goodbyeFrom: EntityId[];
  /** Cursor into `goodbyeFrom` (goodbye stage). */
  goodbyeIx: number;
}

export interface LiveSeasonState {
  week: number;                 // 1-based HOH reign
  beat: Beat;                   // the next beat to resolve
  active: EntityId[];
  /** The player's declared intent for the upcoming competition (B46); consumed when it resolves. */
  compIntent?: Intent;
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
  /**
   * How each evictee read the manner of their eviction toward each responsible houseguest
   * (0037): mannerByEvictee[evictee][responsible]. Recorded live at each eviction so jury
   * management has genuine effect at the finale. ENGINE-ONLY: never crosses the wall.
   */
  mannerByEvictee?: Record<EntityId, Record<EntityId, EvictionManner>>;
  /** The in-progress live finale sub-loop (0037); set when the finale begins. */
  finale?: FinaleProgress;
  /** The in-progress live eviction sub-loop (0047); set while a weekly eviction stages its reveal. */
  eviction?: EvictionProgress;
  /**
   * The SEALED reserve twists (0025/B53): what may fire and at which week. ENGINE-ONLY Vault
   * content carried in the loop state so it persists with the season (0030) — no projection
   * ever selects it, and the Vault store holds the audit copy. Often empty (rare by construction).
   */
  reserve?: ReserveTwist[];
  /**
   * The active twist night: `pending` = sealed for THIS week's eviction (still invisible);
   * `running` = the compressed second cycle is live (revealed). Cleared when the night completes.
   */
  twist?: { kind: TwistKind; phase: "pending" | "running" };
  /** Twists that actually fired (exactly-once bookkeeping + the 0048 unsealing payoff). */
  firedTwists?: TwistEvent[];
  /** The drawn competitions so far, per phase (0042) — feeds the no-immediate-repeat draw; persisted (0030). */
  compHistory?: { hoh: string[]; veto: string[] };
  /** This week's drawn veto comp (def id) — held across a Houseguest's-Choice pause so the resume runs the SAME comp. */
  vetoComp?: string;
}

/** What the live loop reads about the house — kept narrow so the core stays pure/testable. */
export interface SeasonCtx {
  player: EntityId;
  statsOf: (id: EntityId) => Stats;
  rel: RelationshipModel;
  /**
   * The houseguest's LIVE soul emotional state (0041): 0..1, 0.5 = calm baseline. Drives the
   * competition emotional modifier (0006/0028) and the rattled-HOH nomination leaning. Optional so
   * pure tests can omit it (a calm 0.5 default leaves outcomes byte-stable). ENGINE-ONLY — a number
   * that never crosses the wall.
   */
  emotionalOf?: (id: EntityId) => number;
  /**
   * The houseguest's derived LOYALTY (0043: disposition × soul state). When present, decisions
   * gain the emergent BLOC term — bloc-mates shield each other and vote together, scaled by the
   * bloc's loyalty strength. Optional: pure tests omit it and the loop stays byte-stable. The
   * blocs themselves are recomputed every read and NEVER stored (decision 0002).
   */
  loyaltyOf?: (id: EntityId) => number;
  /**
   * The houseguest's static relationship DISPOSITION (0044): gates WHICH nomination tactic an HOH
   * plays (a loyalist sits a pawn; a schemer backdoors; neutral plays direct). Optional: pure
   * tests omit it and every HOH plays the direct, threat-primary read — byte-stable.
   */
  dispositionOf?: (id: EntityId) => RelationshipDisposition;
  /**
   * The OPEN deals binding a houseguest (0039 → 0044): an eviction vote leans away from evicting
   * a party the voter promised to protect — and breaking that lean anyway is a real betrayal the
   * ledger reconciles downstream. Optional: omitted ⇒ no deal term.
   */
  dealsOf?: (id: EntityId) => readonly Deal[];
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
  | { kind: "comp-intent"; intent: Intent }
  | { kind: "houseguests-choice"; pick: EntityId }
  | { kind: "replacement"; replacement: EntityId }
  | { kind: "eviction-vote"; vote: EntityId }
  | { kind: "tie-break"; evict: EntityId }
  | { kind: "final-eviction"; evict: EntityId }
  // --- finale (0037) ---
  | { kind: "finale-statement"; statement: string }
  | { kind: "finale-answer"; appeal: FinaleAppeal }
  | { kind: "juror-vote"; vote: EntityId };

/** Draw this week's competition from the curated library (0042) — seeded, no immediate repeats. */
const drawFor = (s: LiveSeasonState, phase: CompetitionPhase, rng: RandomnessSource): CompetitionDef =>
  drawCompetition(phase, s.week, rng, s.compHistory?.[phase] ?? []);

/** Record a resolved draw into the persisted history (0030) — what the NEXT draw must avoid. */
function recordDraw(s: LiveSeasonState, phase: CompetitionPhase, def: CompetitionDef): void {
  (s.compHistory ??= { hoh: [], veto: [] })[phase].push(def.id);
}

/**
 * Resolve the HOH competition (no state mutation): the eligible field + the engine-decided winner.
 * The SOLE place HOH outcomes are computed — `advance` commits it, `peekCompetition` previews it,
 * both with the same seeded rng, so a narrator's `runCompetition` can never disagree with the loop.
 */
function resolveHoh(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): { def: CompetitionDef; field: EntityId[]; winner: EntityId } {
  // The comp is drawn FIRST (one rng draw) so `advance` and `peekCompetition` replay identically.
  const def = drawFor(s, "hoh", rng);
  // Final 3 (0045): the final-HOH competition lifts the outgoing-HOH restriction — everyone plays.
  const finalThree = s.active.length === 3;
  const field = eligibleForHOH(weekState(s, ctx), finalThree ? { specialAllowsOutgoingHoh: true } : undefined);
  return { def, field, winner: winnerOf(field, def.type, ctx, rng, s.compIntent ?? "compete") };
}

/** Resolve the Power of Veto competition (no state mutation): the six-player field + the winner. */
/** The veto draw resolves to a winner — UNLESS the player drew Houseguest's Choice, which DEFERS (B45). */
type VetoResolution =
  | { def: CompetitionDef; field: EntityId[]; winner: EntityId }
  | { deferred: true; def: CompetitionDef; field: EntityId[]; candidates: EntityId[] };

function resolveVeto(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): VetoResolution {
  // The comp is drawn FIRST (one rng draw) so `advance` and `peekCompetition` replay identically.
  const def = drawFor(s, "veto", rng);
  const draw = vetoParticipants(weekState(s, ctx), rng, {
    houseguestsChoiceChip: true,
    choose: (holder, cands) => ctx.rel.chooseStrongestBond(holder, cands, rng),
    playerChoosesOwn: ctx.player, // the player picks their own sixth player; the engine never reads their bonds
  });
  if (draw.houseguestsChoice && draw.houseguestsChoice.picked === undefined) {
    return { deferred: true, def, field: draw.participants, candidates: draw.houseguestsChoice.candidates };
  }
  return { def, field: draw.participants, winner: winnerOf(draw.participants, def.type, ctx, rng, s.compIntent ?? "compete") };
}

/** Resolve the HOH competition beat (used by `advance` and the comp-intent resume); consumes the intent. */
function resolveHohBeat(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent {
  const finalThree = s.active.length === 3;
  const { def, winner: hoh } = resolveHoh(s, ctx, rng);
  recordDraw(s, "hoh", def); // the comp resolved — the next hoh draw avoids it (0042)
  s.compIntent = undefined; // declared intent consumed (locks: it can't be re-declared after the result)
  s.hoh = hoh;
  s.beat = finalThree ? "final-eviction" : "nominations"; // Final 3 (0045) skips noms/veto
  return {
    beat: "hoh-competition",
    content: `${hoh} wins ${finalThree ? "the final Head of Household" : "Head of Household"}`,
    participants: [hoh],
  };
}

/** Resolve the Power of Veto beat — may pause for a Houseguest's Choice pick (B45); consumes the intent. */
function resolveVetoBeat(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent | null {
  const r = resolveVeto(s, ctx, rng);
  if ("deferred" in r) {
    // The player drew Houseguest's Choice (B45): pause for THEM to pick the sixth player. The declared
    // intent stays set; the houseguests-choice resume runs the SAME drawn comp (0042) with it.
    s.vetoComp = r.def.id;
    s.vetoField = r.field;
    s.pending = { kind: "houseguests-choice", by: ctx.player, options: r.candidates };
    return null;
  }
  recordDraw(s, "veto", r.def); // the comp resolved — the next veto draw avoids it (0042)
  s.compIntent = undefined; // consumed
  s.vetoField = r.field; s.vetoHolder = r.winner; s.beat = "veto-ceremony";
  return { beat: "veto-competition", content: `${r.winner} wins the Power of Veto`, participants: r.field };
}

/** The current competition beat's deterministic outcome (single authority, B37) — or null if the
 *  loop is not at a competition beat. PURE: it does not advance the loop; `advance` crowns the same
 *  winner (same seed) when the beat resolves. */
export interface CompetitionPeek {
  beat: "hoh-competition" | "veto-competition";
  type: CompetitionType;
  /** The drawn library definition (0042): name, format, and the Vault-free narrative scaffold. */
  def: CompetitionDef;
  field: EntityId[];
  winner: EntityId;
}
export function peekCompetition(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): CompetitionPeek | null {
  if (s.pending || s.finished) return null;
  if (s.beat === "hoh-competition") { const { def, field, winner } = resolveHoh(s, ctx, rng); return { beat: s.beat, type: def.type, def, field, winner }; }
  if (s.beat === "veto-competition") {
    const r = resolveVeto(s, ctx, rng);
    if ("deferred" in r) return null; // the player must pick the sixth player first — no preview yet
    return { beat: s.beat, type: r.def.type, def: r.def, field: r.field, winner: r.winner };
  }
  return null;
}

export function newLiveSeason(active: EntityId[]): LiveSeasonState {
  return {
    week: 1, beat: active.length > 2 ? "hoh-competition" : "finale",
    active: [...active], vetoUsed: false, evictionOrder: [], finished: false,
  };
}

function winnerOf(ids: EntityId[], type: CompetitionType, ctx: SeasonCtx, rng: RandomnessSource, playerIntent: Intent = "compete"): EntityId {
  // The LIVE emotional state (0041) feeds the competition emotional modifier (0006/0028): a rattled
  // houseguest competes differently. Defaults to the calm baseline so pure tests stay byte-stable.
  const competitors = ids.map((id) => ({ id, stats: ctx.statsOf(id), emotionalState: ctx.emotionalOf?.(id) ?? 0.5 }));
  // The player's declared intent (B46/audit B5): throw/play-safe carry the 0028 penalties. NPCs stay
  // compete for now. The CompetitionIntents lock fires inside resolveCompetition once the result is given.
  const intents = new CompetitionIntents();
  intents.declare(ctx.player, playerIntent);
  return resolveCompetition(competitors, type, intents, rng).winner;
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

/**
 * Resolve the eviction once a final vote target exists for the player (or none if NPC-only),
 * RECORDING the manner toward each responsible houseguest so jury management has live effect
 * (0037). `votesToEvict` is filled with each voter who voted for the evictee — those voters,
 * plus the HOH who put the nominees up, are the "responsible" houseguests the evictee reads.
 */
/** The house's CURRENT blocs (0043) — derived fresh per decision; [] when loyalty isn't wired. */
function currentBlocs(s: LiveSeasonState, ctx: SeasonCtx): Bloc[] {
  if (!ctx.loyaltyOf) return [];
  return detectBlocs({ rel: ctx.rel, active: s.active, loyaltyOf: ctx.loyaltyOf });
}

/**
 * A voter's pick between the two final nominees — the enriched vote model (feature 0044, layered
 * on the 0002 threat read). The blend, every magnitude from `decisionConstants`:
 *
 *   threat × (1 + paranoia·moodWeight)   — self-protection: a rattled voter's nerves shout loudest (0041)
 *   + blocTerm                            — vote WITH your bloc: shield a mate, lean into the shared enemy (0043)
 *   − dealHonorWeight (if deal-bound)     — an open promise pulls the vote off the protected party (0039);
 *                                           a strong enough opposing read still BREAKS it — and the ledger
 *                                           reconciles that betrayal with its full consequence downstream
 *   − juryMgmt × trust(nominee → voter)   — light jury management: don't make a bitter juror needlessly (0014)
 *
 * Engine-decided + bounded: the terms shade the threat-primary read, never replace it; voting
 * blocs vote TOGETHER because every member computes the same derived bloc (decision 0002).
 */
export function voteChoice(voter: EntityId, fn: [EntityId, EntityId], ctx: SeasonCtx, blocs: readonly Bloc[] = []): EntityId {
  const V = DECISION.vote;
  const paranoia = Math.max(0, (0.5 - (ctx.emotionalOf?.(voter) ?? 0.5)) * 2); // 0 calm … 1 fully rattled
  const deals = ctx.dealsOf?.(voter) ?? [];
  const dealBound = (n: EntityId): boolean =>
    deals.some((d) => d.status === "open" && d.condition.promisors.includes(voter) && d.parties.includes(n) && n !== voter);
  const score = (n: EntityId): number =>
    ctx.rel.edge(voter, n).threat * (1 + paranoia * V.moodSelfProtectWeight) +
    blocTerm(blocs, voter, n) -
    (dealBound(n) ? V.dealHonorWeight : 0) -
    V.juryManagementWeight * ctx.rel.edge(n, voter).trust;
  return score(fn[0]) >= score(fn[1]) ? fn[0] : fn[1];
}

/** Count the eviction votes (NPCs threat-driven; the player's own vote, if any) WITHOUT breaking a tie. */
function countEvictionVotes(s: LiveSeasonState, ctx: SeasonCtx, playerVote?: EntityId): {
  fn: [EntityId, EntityId]; votes: Record<EntityId, number>; voteOf: Map<EntityId, EntityId>;
} {
  const fn = s.finalNominees!;
  const voters = evictionVoters({ ...weekState(s, ctx), nominees: fn });
  const blocs = currentBlocs(s, ctx); // one derived read for the whole vote — the bloc votes together
  const votes: Record<EntityId, number> = { [fn[0]]: 0, [fn[1]]: 0 };
  const voteOf = new Map<EntityId, EntityId>();
  for (const v of voters) {
    const target = v === ctx.player && playerVote ? playerVote : voteChoice(v, fn, ctx, blocs);
    votes[target]++;
    voteOf.set(v, target);
  }
  return { fn, votes, voteOf };
}

/**
 * How an evictee reads being moved against by a responsible houseguest (0037). Simple,
 * documented, defensible — the BDD only asserts the directional property. A houseguest the
 * evictee TRUSTED who moved against them ⇒ betrayed; an eviction the evictee did not see
 * coming (they read the houseguest as low-threat) ⇒ blindsided. ENGINE-ONLY (never crosses
 * the wall): it shapes the hidden jury lean, not any player-facing surface.
 */
function mannerToward(evictee: EntityId, responsible: EntityId, ctx: SeasonCtx): EvictionManner {
  const e = ctx.rel.edge(evictee, responsible);
  if (e.trust > MANNER_THRESHOLDS.trustBetrayal) return { betrayed: true };   // trusted them, yet they moved against me
  if (e.threat < MANNER_THRESHOLDS.threatBlindside) return { blindsided: true }; // read them as no threat — never saw it coming
  return { respected: true }; // a clean, expected move from a known rival — no grievance
}

/**
 * Record the evictee's manner read toward every responsible houseguest (HOH + evict-voters).
 * Jury management cuts BOTH ways: the player is recorded like any other responsible houseguest
 * (audit A5 — no exemption), so a juror the player blindsided/betrayed on the way out weighs that
 * against them at the player's own finale (0037 §4.2). ENGINE-ONLY: the number never crosses the wall.
 */
function recordEvictionManner(s: LiveSeasonState, evictee: EntityId, responsible: EntityId[], ctx: SeasonCtx): void {
  const map = (s.mannerByEvictee ??= {});
  const row = (map[evictee] ??= {});
  for (const r of responsible) {
    if (r === evictee) continue; // a houseguest is never "responsible" for their own eviction
    row[r] = mannerToward(evictee, r, ctx);
  }
}

/**
 * Record a broken-deal demerit (0039): the wronged party will weigh this betrayal against the
 * breaker in their later jury lean. Stored as `manner.betrayed` in the same map the finale reads
 * (`mannerFor`), merged so a later eviction-manner read keeps it rather than clobbering it.
 */
export function recordDealBetrayal(s: LiveSeasonState, wronged: EntityId, breaker: EntityId): void {
  const map = (s.mannerByEvictee ??= {});
  const row = (map[wronged] ??= {});
  row[breaker] = { ...(row[breaker] ?? {}), betrayed: true };
}

/**
 * E89: has the season's FIRST ceremony beat (the week-1 HOH result) resolved yet? Pure and
 * DERIVED — never stored: any of these only exist once at least one ceremony beat committed
 * (rollWeek clears `hoh` but bumps `week` and sets `outgoingHoh`, so the predicate stays true
 * for the rest of the season). Gates NPC approaches (`socialInitiatives`) per ruling #5:
 * move-in gets room to breathe before anyone "wants a word".
 */
export function firstCeremonyBeatResolved(s: LiveSeasonState): boolean {
  return (
    s.finished ||
    s.week > 1 ||
    s.evictionOrder.length > 0 ||
    s.outgoingHoh !== undefined ||
    s.hoh !== undefined ||
    s.nominees !== undefined
  );
}

/** Record the evictee as out (evictionOrder + remove from the live house). Does NOT roll the week. */
function removeEvictee(s: LiveSeasonState, evictee: EntityId): void {
  s.evictee = evictee;
  s.evictionOrder.push(evictee);
  s.active = s.active.filter((h) => h !== evictee);
}

/** Roll into the next week (or the finale at Final 3 → 2): clear the week's ceremony state. */
function rollWeek(s: LiveSeasonState): void {
  s.outgoingHoh = s.hoh;
  s.hoh = undefined; s.nominees = undefined; s.vetoField = undefined;
  s.vetoHolder = undefined; s.vetoUsed = false; s.saved = undefined;
  s.replacement = undefined; s.finalNominees = undefined; s.vetoComp = undefined;
  if (s.active.length <= 2) {
    s.beat = "finale";
    return;
  }
  // 0025/B53 — a SEALED double eviction fires NOW: the same night runs a compressed second cycle
  // (HOH → noms → veto → vote, the hard rules verbatim — the outgoing HOH just set above cannot
  // play the second crown). Same week number: one twist night, two eviction ceremonies. Needs a
  // big-enough house (> 3 after the first eviction) to run a meaningful cycle; otherwise the
  // sealed twist simply never fires (0048's "the twist that never fired").
  if (s.twist?.phase === "pending" && s.twist.kind === "double-eviction" && s.active.length > 3) {
    s.twist = { kind: s.twist.kind, phase: "running" };
    s.beat = "twist-reveal";
    return;
  }
  if (s.twist?.phase === "running") {
    // The second evictee just walked out — the twist night is complete (exactly once).
    (s.firedTwists ??= []).push({ kind: s.twist.kind, beat: s.week });
    s.twist = undefined;
  }
  s.week += 1; s.beat = "hoh-competition";
  // Arm a sealed twist scheduled for the week we just rolled into; it stays invisible until the
  // night's eviction lands (the reveal IS the firing — there is no "a twist is coming" tell).
  const due = maybeFireTwist(s.week, s.reserve ?? []);
  if (due && !s.twist) s.twist = { kind: due.kind, phase: "pending" };
}

/** Atomic eviction (record manner + remove + roll) — used by the non-staged paths (Final-3 0045). */
function applyEviction(s: LiveSeasonState, evictee: EntityId, ctx: SeasonCtx, responsible: EntityId[]): void {
  recordEvictionManner(s, evictee, responsible, ctx);
  removeEvictee(s, evictee);
  rollWeek(s);
}

// --- Live eviction sub-loop (0047) --------------------------------------------

/** How many houseguests leave a goodbye message (bounded; seeded selection of the remaining house). */
const GOODBYE_MESSAGE_COUNT = 3;

/** A seeded Fisher–Yates shuffle (does not mutate the input) — the engine-decided reveal order. */
function seededShuffle<T>(items: readonly T[], rng: RandomnessSource): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * The tone of a houseguest's goodbye message to the evictee — DERIVED from real relationship state
 * (anti-sycophancy: never narration). A houseguest who liked the evictee sends a warm one; a cold read
 * sends a cold one; otherwise a respectful nod. (0047 §4.)
 */
export type GoodbyeTone = "warm" | "respectful" | "cold";

function goodbyeTone(sender: EntityId, evictee: EntityId, ctx: SeasonCtx): GoodbyeTone {
  const e = ctx.rel.edge(sender, evictee);
  if (e.affinity >= 0.6) return "warm";
  if (e.affinity <= 0.35) return "cold";
  return "respectful";
}

/** How a goodbye tone folds into the evictee's read of the sender (feeds jury lean, 0014/0037 §4.2). */
export function goodbyeMannerFor(tone: GoodbyeTone): EvictionManner {
  if (tone === "warm" || tone === "respectful") return { respected: true };
  return { disrespected: true }; // a cold send-off stings — the evictee weighs it against them
}

/** The seeded houseguests who leave a goodbye message (from the house remaining after the eviction). */
function selectGoodbyeSenders(s: LiveSeasonState, evictee: EntityId, rng: RandomnessSource): EntityId[] {
  const remaining = s.active.filter((h) => h !== evictee);
  return seededShuffle(remaining, rng).slice(0, Math.min(GOODBYE_MESSAGE_COUNT, remaining.length));
}

/** The revealed-only tally of an in-progress reveal: votes read so far for each nominee. */
function revealedTally(e: EvictionProgress): Record<EntityId, number> {
  const tally: Record<EntityId, number> = { [e.nominees[0]]: 0, [e.nominees[1]]: 0 };
  for (let i = 0; i < e.revealIx; i++) tally[e.voteOf[e.revealOrder[i]!]!]! += 1;
  return tally;
}

/** Begin the staged eviction: precompute the (already-decided) votes + the seeded reveal order. */
function beginEviction(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource, playerVote: EntityId | undefined): void {
  const { fn, voteOf } = countEvictionVotes(s, ctx, playerVote);
  s.eviction = {
    stage: "votes",
    nominees: fn,
    revealOrder: seededShuffle([...voteOf.keys()], rng),
    voteOf: Object.fromEntries(voteOf),
    revealIx: 0,
    goodbyeFrom: [],
    goodbyeIx: 0,
  };
}

/**
 * Advance the live eviction ONE step (0047). votes (reveal one at a time, seeded) → the result lands
 * on the LAST vote (tally + HOH tie-break) → goodbye (an evictee goodbye + goodbye messages whose tone
 * folds into manner) → the house rolls into the next week. Pauses (returns null with `s.pending` set)
 * only for the player-HOH tie-break; everything else resolves deterministically.
 */
function advanceEviction(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent | null {
  const e = s.eviction!;
  switch (e.stage) {
    case "votes": {
      if (e.revealIx < e.revealOrder.length) {
        const voter = e.revealOrder[e.revealIx]!;
        const votedFor = e.voteOf[voter]!;
        e.revealIx += 1;
        return { beat: "eviction-reveal", content: `${voter} votes to evict ${votedFor}`, participants: [voter, votedFor] };
      }
      // The last vote is read: the tally decides (HOH breaks a tie — the player HOH pauses, B44).
      const tally = revealedTally(e);
      let evictee: EntityId;
      if (tally[e.nominees[0]]! > tally[e.nominees[1]]!) evictee = e.nominees[0];
      else if (tally[e.nominees[1]]! > tally[e.nominees[0]]!) evictee = e.nominees[1];
      else {
        if (s.hoh === ctx.player) { s.pending = { kind: "tie-break", by: ctx.player, nominees: e.nominees }; return null; }
        evictee = voteChoice(s.hoh!, e.nominees, ctx, currentBlocs(s, ctx));
      }
      return commitStagedEviction(s, ctx, evictee, rng);
    }
    case "goodbye": {
      if (e.goodbyeIx < e.goodbyeFrom.length) {
        const sender = e.goodbyeFrom[e.goodbyeIx]!;
        e.goodbyeIx += 1;
        const tone = goodbyeTone(sender, e.evictee!, ctx);
        // The tone folds into the evictee's manner toward the sender (merged — a goodbye is the last word).
        const row = (s.mannerByEvictee![e.evictee!] ??= {});
        row[sender] = { ...(row[sender] ?? {}), ...goodbyeMannerFor(tone) };
        return { beat: "eviction-goodbye", content: `${sender} leaves ${e.evictee} a ${tone} goodbye message`, participants: [sender, e.evictee!] };
      }
      e.stage = "result";
      return advanceEviction(s, ctx, rng);
    }
    case "result": {
      const evictee = e.evictee!;
      s.eviction = undefined;
      rollWeek(s); // the week's ceremony state clears and the house rolls on (or into the finale)
      return { beat: "eviction-result", content: `${evictee} leaves the house`, participants: [evictee] };
    }
  }
}

/** Once the evictee is known: record responsible manner, remove them, seed the goodbyes, open that stage. */
function commitStagedEviction(s: LiveSeasonState, ctx: SeasonCtx, evictee: EntityId, rng: RandomnessSource): BeatEvent {
  const e = s.eviction!;
  e.evictee = evictee;
  const votesToEvict = Object.entries(e.voteOf).filter(([, t]) => t === evictee).map(([v]) => v);
  recordEvictionManner(s, evictee, [s.hoh!, ...votesToEvict], ctx);
  removeEvictee(s, evictee);          // out now — the last vote landed; the result is public
  e.goodbyeFrom = selectGoodbyeSenders(s, evictee, rng);
  e.stage = "goodbye";
  return { beat: "eviction", content: `${evictee} is evicted`, participants: [evictee] };
}

// --- Live finale sub-loop (0037) ----------------------------------------------

/** The juror's directed read of a finalist, as the jury math (0014) wants it. */
function edgeAsJuryRel(juror: EntityId, finalist: EntityId, ctx: SeasonCtx): JuryRel {
  const e = ctx.rel.edge(juror, finalist);
  return { trust: e.trust, affinity: e.affinity, threat: e.threat };
}

/** The recorded manner the evictee/juror read toward a finalist (empty if none). */
function mannerFor(s: LiveSeasonState, juror: EntityId, finalist: EntityId): EvictionManner {
  return s.mannerByEvictee?.[juror]?.[finalist] ?? {};
}

/** Record the appeal a finalist made to a juror (appeals[finalist][juror]). */
function recordAppeal(f: FinaleProgress, finalist: EntityId, juror: EntityId, appeal: FinaleAppeal): void {
  (f.appeals[finalist] ??= {})[juror] = appeal;
}

/**
 * The appeal a finalist made to a juror — their recorded choice. With the 18-Q&A finale every juror
 * questions BOTH finalists (audit A6 ruling), so every (finalist, juror) pair is answered and the
 * `bestAppeal` fallback below is a NEVER-HIT safety guard (kept so a malformed script can't crash the
 * tally). The player answers their own 9; the NPC's 9 are its `bestAppeal` — symmetric by construction.
 */
function appealMade(
  f: FinaleProgress, finalist: EntityId, juror: EntityId, ctx: SeasonCtx, s: LiveSeasonState,
): FinaleAppeal {
  return f.appeals[finalist]?.[juror] ?? bestAppeal(edgeAsJuryRel(juror, finalist, ctx), mannerFor(s, juror, finalist));
}

/** Begin the live finale: lock the Final 2, the last-9 jury, and the engine choreography. */
function beginFinale(s: LiveSeasonState): FinaleProgress {
  const finalists: [EntityId, EntityId] = [s.active[0]!, s.active[1]!];
  const jury = s.evictionOrder.slice(-9);
  const script = buildFinaleScript(finalists, jury);
  return {
    stage: "statements", finalists, jury, script,
    statementIx: 0, questionIx: 0, appeals: {}, revealIx: 0,
  };
}

/**
 * Precompute every juror's vote ONCE (so the tally and the one-at-a-time reveal agree), driving
 * each through `castJuryVote` with the engine lean (relationship + recorded manner) and the
 * BOUNDED finale performance (`appealEffect` of the appeal actually made). The player's own juror
 * vote, if any, is already recorded and is preserved. Deterministic for a given seed.
 */
function precomputeVotes(s: LiveSeasonState, ctx: SeasonCtx, f: FinaleProgress, rng: RandomnessSource): Record<EntityId, EntityId> {
  const votes: Record<EntityId, EntityId> = { ...(f.votes ?? {}) };
  for (const juror of f.jury) {
    if (votes[juror]) continue; // the player's own vote (recorded interactively) is kept
    const leanFor = (fin: EntityId): number => juryLean(edgeAsJuryRel(juror, fin, ctx), mannerFor(s, juror, fin));
    // Each juror questioned BOTH finalists (18-Q&A), so each has a recorded appeal here — scored
    // symmetrically by the same `appealEffect`; the player's own answers are exactly as weighted as the NPC's.
    const perfFor = (fin: EntityId): number => appealEffect(appealMade(f, fin, juror, ctx, s), edgeAsJuryRel(juror, fin, ctx), mannerFor(s, juror, fin));
    votes[juror] = castJuryVote(f.finalists, leanFor, perfFor, rng);
  }
  return votes;
}

/**
 * Advance the live finale ONE step (0037). Statements → each juror questions both finalists → the
 * vote → a one-at-a-time reveal → the winner. Pauses (returns null with `s.pending` set) for the
 * player's own statement / answers / juror vote; everything else resolves deterministically.
 */
function advanceFinale(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent | null {
  const f = (s.finale ??= beginFinale(s));
  switch (f.stage) {
    case "statements": {
      if (f.statementIx >= f.script.statements.length) { f.stage = "questions"; return advanceFinale(s, ctx, rng); }
      const finalist = f.script.statements[f.statementIx]!;
      if (finalist === ctx.player) {
        s.pending = { kind: "finale-statement", by: ctx.player };
        return null;
      }
      f.statementIx += 1;
      return { beat: "finale", content: `${finalist} gives an opening statement`, participants: [finalist] };
    }
    case "questions": {
      if (f.questionIx >= f.script.questions.length) { f.stage = "vote"; return advanceFinale(s, ctx, rng); }
      const q = f.script.questions[f.questionIx]!;
      if (q.finalist === ctx.player) {
        s.pending = { kind: "finale-answer", by: ctx.player, juror: q.juror, appeals: [...FINALE_APPEALS] };
        return null;
      }
      // NPC finalist answers optimally for this juror (deterministic argmax), recorded for the tally.
      const appeal = bestAppeal(edgeAsJuryRel(q.juror, q.finalist, ctx), mannerFor(s, q.juror, q.finalist));
      recordAppeal(f, q.finalist, q.juror, appeal);
      f.questionIx += 1;
      return { beat: "finale", content: `${q.finalist} answers ${q.juror}`, participants: [q.finalist, q.juror] };
    }
    case "vote": {
      // If the player is a juror and hasn't voted yet, stop for their own vote first.
      if (f.jury.includes(ctx.player) && !(f.votes?.[ctx.player])) {
        s.pending = { kind: "juror-vote", by: ctx.player, finalists: f.finalists };
        return null;
      }
      f.votes = precomputeVotes(s, ctx, f, rng);
      f.stage = "reveal";
      return { beat: "finale", content: `the jury casts their votes`, participants: [...f.finalists] };
    }
    case "reveal": {
      if (f.revealIx < f.script.revealOrder.length) {
        const juror = f.script.revealOrder[f.revealIx]!;
        const voted = f.votes![juror]!;
        f.revealIx += 1;
        return { beat: "finale-reveal", content: `${juror} votes for ${voted}`, participants: [juror, voted] };
      }
      // All votes revealed: tally (last-evicted-juror tie-break, reused) and crown the winner.
      const winner = tallyJury(f.jury, f.finalists, (j) => f.votes![j]!, s.evictionOrder);
      s.finalTwo = f.finalists; s.jury = f.jury; s.winner = winner; s.finished = true; s.beat = "complete";
      const loser = f.finalists.find((x) => x !== winner)!;
      return { beat: "finale-result", content: `${winner} wins the season over ${loser}`, participants: [...f.finalists] };
    }
  }
}

/**
 * Advance one beat. Returns the meaningful event produced, or `null` if the loop is
 * blocked on a player decision (`state.pending` is set) or already complete.
 */
export function advance(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent | null {
  if (s.pending || s.finished || s.beat === "complete") return null;

  switch (s.beat) {
    case "hoh-competition": {
      // B46: if the player plays this comp and hasn't declared intent, pause for compete/throw/play-safe.
      const finalThree = s.active.length === 3;
      const field = eligibleForHOH(weekState(s, ctx), finalThree ? { specialAllowsOutgoingHoh: true } : undefined);
      if (s.compIntent === undefined && field.includes(ctx.player)) {
        s.pending = { kind: "comp-intent", by: ctx.player, comp: "hoh-competition" };
        return null;
      }
      return resolveHohBeat(s, ctx, rng);
    }
    case "final-eviction": {
      // Final 3 (0045): the final HOH evicts one of the other two; the survivor + HOH are the Final 2.
      const rivals = s.active.filter((h) => h !== s.hoh) as EntityId[];
      if (s.hoh === ctx.player) {
        s.pending = { kind: "final-eviction", by: ctx.player, options: [rivals[0]!, rivals[1]!] };
        return null;
      }
      // NPC final HOH evicts the higher-threat rival (relationship-driven, decision 0002).
      const evictee = [...rivals].sort((a, b) => ctx.rel.edge(s.hoh!, b).threat - ctx.rel.edge(s.hoh!, a).threat)[0]!;
      const ev: BeatEvent = { beat: "final-eviction", content: `${s.hoh} evicts ${evictee}, setting the Final 2`, participants: [s.hoh!, evictee] };
      applyEviction(s, evictee, ctx, [s.hoh!]);
      return ev;
    }
    case "nominations": {
      if (s.hoh === ctx.player) {
        s.pending = { kind: "nominations", by: ctx.player, options: s.active.filter((h) => h !== ctx.player), pick: 2 };
        return null;
      }
      // The strategic nomination read (0044): threat-primary, bent by the rattled-HOH paranoia
      // term (0041), the bloc shield (0043), the week's political temperature, and the HOH's own
      // disposition-gated tactic (pawn / backdoor / direct). Legality still binds downstream.
      const nominees = nominationStrategy(s.hoh!, s.active, ctx.rel, {
        blocs: currentBlocs(s, ctx),
        mood: ctx.emotionalOf?.(s.hoh!) ?? 0.5,
        disposition: ctx.dispositionOf?.(s.hoh!) ?? "neutral",
      });
      s.nominees = nominees; s.beat = "veto-competition";
      return { beat: "nominations", content: `${s.hoh} nominates ${nominees[0]} and ${nominees[1]}`, participants: [s.hoh!, ...nominees] };
    }
    case "veto-competition": {
      // B46: the player plays the veto if they're a puller (HOH or a nominee) — pause for intent first.
      const pullers = [s.hoh, ...(s.nominees ?? [])].filter((id): id is EntityId => !!id);
      if (s.compIntent === undefined && pullers.includes(ctx.player)) {
        s.pending = { kind: "comp-intent", by: ctx.player, comp: "veto-competition" };
        return null;
      }
      return resolveVetoBeat(s, ctx, rng);
    }
    case "veto-ceremony": {
      const nominees = s.nominees!;
      if (s.vetoHolder === ctx.player) {
        // The holder may save either nominee (incl. self if nominated) — the whole pair is saveable.
        s.pending = { kind: "veto-decision", by: ctx.player, nominees, saveable: [...nominees] };
        return null;
      }
      // NPC veto holder: save self if nominated, else a strongly-trusted nominee.
      const saved = nominees.includes(s.vetoHolder!)
        ? s.vetoHolder!
        : nominees.find((n) => ctx.rel.edge(s.vetoHolder!, n).trust > RELATIONSHIP_CONSTANTS.thresholds.vetoSave);
      if (!saved) {
        s.vetoUsed = false; s.finalNominees = [nominees[0], nominees[1]]; s.beat = "eviction";
        return { beat: "veto-ceremony", content: `${s.vetoHolder} does not use the veto`, participants: [s.vetoHolder!] };
      }
      s.vetoUsed = true; s.saved = saved;
      return resolveReplacement(s, ctx); // either pends on the player-HOH or NPC-picks, then → eviction
    }
    case "eviction": {
      if (s.eviction) return advanceEviction(s, ctx, rng); // a reveal is already staging — step it
      const fn = s.finalNominees!;
      const voters = evictionVoters({ ...weekState(s, ctx), nominees: fn });
      if (voters.includes(ctx.player)) {
        s.pending = { kind: "eviction-vote", by: ctx.player, nominees: fn };
        return null;
      }
      // The player is HOH or a nominee: NPC votes are decided; stage the one-at-a-time reveal (0047).
      beginEviction(s, ctx, rng, undefined);
      return advanceEviction(s, ctx, rng);
    }
    case "twist-reveal": {
      // The sealed twist FIRES (0025): a dramatic, witnessed production reveal — only now is it
      // known to anyone. The compressed second cycle opens at a fresh HOH competition.
      s.beat = "hoh-competition";
      return {
        beat: "twist-reveal",
        content: "But the night is not over — this is a DOUBLE EVICTION. A new Head of Household " +
          "will be crowned and a second houseguest will walk out that door tonight.",
        participants: [...s.active],
      };
    }
    case "finale":
      return advanceFinale(s, ctx, rng);
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
  // The replacement reads the same blended strategy (0044): threat + the rattled-paranoia term +
  // the bloc shield. This is also what COMPLETES a backdoor — the real target, left off the block
  // at nominations, tops this ranking the moment the veto comes off.
  const mood = ctx.emotionalOf?.(s.hoh!) ?? 0.5;
  const blocs = currentBlocs(s, ctx);
  const replacement = [...options].sort((a, b) =>
    (nominationScore(s.hoh!, b, ctx.rel, mood) + blocTerm(blocs, s.hoh!, b)) -
    (nominationScore(s.hoh!, a, ctx.rel, mood) + blocTerm(blocs, s.hoh!, a)))[0]!;
  s.replacement = replacement; s.finalNominees = [otherNominee(s), replacement]; s.beat = "eviction";
  return {
    beat: "veto-ceremony",
    content: `${s.vetoHolder} uses the veto on ${s.saved}; ${s.hoh} names ${replacement} as the replacement`,
    participants: [s.vetoHolder!, s.saved!, s.hoh!, replacement],
  };
}

/**
 * The NPC policy for ANY pending player decision (B55/audit D12): what an NPC sitting in the
 * player's seat would do, by the SAME relationship-driven reads the loop's own NPC paths use.
 * Lets the calibration driver (`playSeason`) and tests auto-answer pendings so the one live
 * loop plays unattended — there is no second rulebook to drift.
 */
export function autoDecision(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): DecisionInput {
  const p = s.pending;
  if (!p) throw new Error("no pending decision to auto-resolve");
  const byThreat = (holder: EntityId, cands: readonly EntityId[]): EntityId =>
    [...cands].sort((a, b) => ctx.rel.edge(holder, b).threat - ctx.rel.edge(holder, a).threat)[0]!;
  switch (p.kind) {
    case "comp-intent":
      return { kind: "comp-intent", intent: "compete" };
    case "nominations": {
      // The same strategic read the loop's own NPC HOHs use (no second rulebook).
      const [a, b] = nominationStrategy(p.by, s.active, ctx.rel, {
        blocs: currentBlocs(s, ctx),
        mood: ctx.emotionalOf?.(p.by) ?? 0.5,
        disposition: ctx.dispositionOf?.(p.by) ?? "neutral",
      });
      return { kind: "nominations", choice: [a, b] };
    }
    case "veto-decision": {
      // Mirror the NPC veto holder: save self if nominated, else a strongly-trusted nominee.
      const saved = p.nominees.includes(p.by)
        ? p.by
        : p.nominees.find((n) => ctx.rel.edge(p.by, n).trust > RELATIONSHIP_CONSTANTS.thresholds.vetoSave);
      return saved ? { kind: "veto-decision", use: true, save: saved } : { kind: "veto-decision", use: false };
    }
    case "houseguests-choice":
      return { kind: "houseguests-choice", pick: ctx.rel.chooseStrongestBond(p.by, p.options, rng) };
    case "replacement":
      return { kind: "replacement", replacement: byThreat(p.by, p.options) };
    case "eviction-vote":
      return { kind: "eviction-vote", vote: voteChoice(p.by, p.nominees, ctx, currentBlocs(s, ctx)) };
    case "tie-break":
      return { kind: "tie-break", evict: voteChoice(p.by, p.nominees, ctx, currentBlocs(s, ctx)) };
    case "final-eviction":
      return { kind: "final-eviction", evict: byThreat(p.by, p.options) };
    case "finale-statement":
      return { kind: "finale-statement", statement: "" };
    case "finale-answer":
      return { kind: "finale-answer", appeal: bestAppeal(edgeAsJuryRel(p.juror, p.by, ctx), mannerFor(s, p.juror, p.by)) };
    case "juror-vote": {
      const lean = (fin: EntityId): number => juryLean(edgeAsJuryRel(p.by, fin, ctx), mannerFor(s, p.by, fin));
      return { kind: "juror-vote", vote: lean(p.finalists[0]) >= lean(p.finalists[1]) ? p.finalists[0] : p.finalists[1] };
    }
  }
}

/** Apply the player's decision for the current `pending`, then continue to the next beat. */
export function applyDecision(
  s: LiveSeasonState, input: DecisionInput, ctx: SeasonCtx,
  // Only the Houseguest's-Choice resume needs randomness (to run the veto comp once the field completes);
  // the live adapter passes the beat-deterministic rng, so the same seed reproduces the same outcome.
  rng: RandomnessSource = new SeededRandom(1),
): BeatEvent {
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
      // Validate BEFORE consuming the pending decision (B59/audit I): an illegal save must refuse
      // and leave the decision standing — the old order cleared `pending` first and stranded the loop.
      const save = input.use ? input.save : undefined;
      if (input.use && (!save || !nominees.includes(save))) throw new Error("can only veto a current nominee");
      s.pending = undefined;
      if (!input.use) {
        s.vetoUsed = false; s.finalNominees = [nominees[0], nominees[1]]; s.beat = "eviction";
        return { beat: "veto-ceremony", content: `${ctx.player} does not use the veto`, participants: [ctx.player] };
      }
      s.vetoUsed = true; s.saved = save!;
      // The HOH names the replacement. If the player is ALSO HOH, that's the next decision.
      const ev = resolveReplacement(s, ctx);
      return ev ?? { beat: "veto-ceremony", content: `${ctx.player} uses the veto on ${save}`, participants: [ctx.player, save!] };
    }
    case "comp-intent": {
      // B46/audit B5: the player declares compete/throw/play-safe; the comp then resolves with it.
      s.compIntent = input.intent;
      s.pending = undefined;
      if (s.beat === "hoh-competition") return resolveHohBeat(s, ctx, rng);
      const veto = resolveVetoBeat(s, ctx, rng);
      // The veto may have deferred to a Houseguest's Choice pick (B45) — surface the declaration as the beat.
      return veto ?? { beat: "veto-competition", content: `${ctx.player} sets their competition strategy`, participants: [ctx.player] };
    }
    case "houseguests-choice": {
      // The player drew Houseguest's Choice and picks the sixth veto player (B45/audit B4).
      const options = (s.pending as { options: EntityId[] }).options;
      if (!options.includes(input.pick)) throw new Error("the Houseguest's Choice must pick an eligible candidate");
      s.pending = undefined;
      const field = [...s.vetoField!, input.pick]; // the player's pick completes the field
      // The SAME comp drawn at the deferral (0042) — looked up, never re-drawn (restart-safe, 0030).
      const def = (s.vetoComp ? competitionById(s.vetoComp) : undefined) ?? drawFor(s, "veto", rng);
      const holder = winnerOf(field, def.type, ctx, rng, s.compIntent ?? "compete");
      recordDraw(s, "veto", def);
      s.compIntent = undefined; // the declared intent is consumed
      s.vetoField = field; s.vetoHolder = holder; s.beat = "veto-ceremony";
      return { beat: "veto-competition", content: `${holder} wins the Power of Veto`, participants: field };
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
      // The player is a voter ⇒ the HOH is an NPC ⇒ no player tie-break; stage the reveal with their vote (0047).
      beginEviction(s, ctx, rng, input.vote);
      return advanceEviction(s, ctx, rng)!; // the first vote reveal — never pends (the player is not the HOH)
    }
    case "tie-break": {
      // The player Head of Household breaks a tied eviction vote, after the reveal (B44/audit B2 · 0047).
      const e = s.eviction!;
      if (!e.nominees.includes(input.evict)) throw new Error("the tie-break must choose a current nominee");
      s.pending = undefined;
      return commitStagedEviction(s, ctx, input.evict, rng);
    }
    case "final-eviction": {
      // Final 3 (0045): the player IS the final HOH and personally evicts one of the other two.
      const rivals = s.active.filter((h) => h !== s.hoh);
      if (!rivals.includes(input.evict)) throw new Error("can only evict one of the other two finalists");
      s.pending = undefined;
      const ev: BeatEvent = { beat: "final-eviction", content: `${s.hoh} evicts ${input.evict}, setting the Final 2`, participants: [s.hoh!, input.evict] };
      applyEviction(s, input.evict, ctx, [s.hoh!]);
      return ev;
    }
    // --- finale (0037) ---------------------------------------------------------
    case "finale-statement": {
      const f = s.finale!;
      const p = s.pending;
      if (!p || p.kind !== "finale-statement") throw new Error("no pending finale statement");
      // Free-text flavor — carries NO score (anti-sycophancy: only structured appeals sway).
      const by = p.by;
      s.pending = undefined;
      f.statementIx += 1;
      return { beat: "finale", content: `${by} gives an opening statement`, participants: [by] };
    }
    case "finale-answer": {
      const f = s.finale!;
      const p = s.pending;
      if (!p || p.kind !== "finale-answer") throw new Error("no pending finale answer");
      if (!FINALE_APPEALS.includes(input.appeal)) throw new Error("no legal appeal");
      recordAppeal(f, p.by, p.juror, input.appeal);
      s.pending = undefined;
      f.questionIx += 1;
      return { beat: "finale", content: `${p.by} answers ${p.juror}`, participants: [p.by, p.juror] };
    }
    case "juror-vote": {
      const f = s.finale!;
      const p = s.pending;
      if (!p || p.kind !== "juror-vote") throw new Error("no pending juror vote");
      // An illegal vote (not one of the two finalists) is refused; the pending decision stands.
      if (!p.finalists.includes(input.vote)) throw new Error("can only vote for one of the two finalists");
      (f.votes ??= {})[ctx.player] = input.vote;
      s.pending = undefined;
      return { beat: "finale", content: `you cast your jury vote`, participants: [ctx.player] };
    }
  }
}
