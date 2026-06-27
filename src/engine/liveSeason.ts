import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { resolveCompetition, eliminationOrder, CompetitionIntents } from "../domain/competitionOutcome";
import type { CompetitionType, Intent, Competitor, CompetitionResult } from "../domain/competitionOutcome";

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
  runFinale as buildFinaleScript, castJuryVote, juryLean, appealEffect, bestAppeal, gameRespectTerm, JURY_WEIGHTS,
  FINALE_APPEALS, type EvictionManner, type FinaleAppeal, type FinaleScript, type JuryRel,
} from "./jury";
import { MANNER_THRESHOLDS, MANNER_GRADING } from "./juryConstants";
import { RELATIONSHIP_CONSTANTS } from "./relationshipConstants";
import { maybeFireTwist } from "./reserveTwists";
import type { ReserveTwist, TwistEvent, TwistKind } from "./reserveTwists";
import { drawCompetition, competitionById } from "./competitionLibrary";
import type { CompetitionDef, CompetitionPhase } from "./competitionLibrary";
import { phaseForDepth, bedtimeDepthFor, restDeficitForDepth, DAY_START, type TimeOfDay } from "./timeOfDay";

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
  // the witnessed veto chip-draw ceremony (E35) — emitted on BeatEvent only; the structural
  // beat stays `veto-competition` (the draw is its first stage, the comp its second).
  | "veto-draw"
  // a single STAGED elimination round (0006 staged-rounds evolution) — emitted on BeatEvent only; the
  // structural beat stays `hoh-competition`/`veto-competition`. The CROWN event keeps the comp beat key
  // (so the HOH/veto win still folds its consequence); only the per-round drops carry this distinct key.
  | "comp-elimination"
  // a sealed reserve twist firing (0025/B53): the production reveal that opens a twist night.
  | "twist-reveal"
  // finale sub-loop events (0037) — emitted on BeatEvent only; never a structural `s.beat`.
  | "finale-reveal" | "finale-result"
  // eviction sub-loop events (0047) — emitted on BeatEvent only; the staged reveal/goodbye/result.
  | "eviction-reveal" | "eviction-goodbye" | "eviction-result"
  // the player's voluntary walk-out (0061) — a recorded, witnessed, non-hidden exit event; emitted
  // on BeatEvent only (the structural transition is the player's removal + the terminal `selfEvicted`).
  | "self-eviction";

/**
 * The INERT, presentation-only beats (0006 staged-rounds): a per-round staged-competition DROP. It
 * carries NO rng, NO consequence fold, NO soul inflection (it falls through every commit side-effect
 * switch) — pure re-telling of an already-fixed outcome (see `advanceCompetition` /
 * `stagedTrajectoryNeutral`). The crown keeps its comp beat key (so its consequence still folds) and
 * is NOT inert. Callers that gate substantive side-effects (e.g. the ADR-0006 clock, #537) consult this
 * so an inert reveal can never perturb game state the same way it can never perturb the seeded stream.
 */
const INERT_BEATS: ReadonlySet<Beat> = new Set<Beat>(["comp-elimination"]);

/** Whether a beat is an inert, presentation-only staged reveal (no rng / no fold / no clock advance). */
export function isInertBeat(beat: Beat): boolean {
  return INERT_BEATS.has(beat);
}

/** A player decision the live loop is blocked on until `applyDecision` resolves it. */
export type PendingDecision =
  | { kind: "nominations"; by: EntityId; options: EntityId[]; pick: 2 }
  | { kind: "veto-decision"; by: EntityId; nominees: [EntityId, EntityId]; saveable: EntityId[] }
  // --- competition intent (B46/audit B5): the player declares compete/throw/play-safe before a comp ---
  | { kind: "comp-intent"; by: EntityId; comp: "hoh-competition" | "veto-competition" }
  // --- STAGED competition round (0006 staged-rounds evolution): the player declares their approach for
  // THIS elimination round, seeing who is still in. Committed BEFORE the round resolves (anti-sycophancy);
  // once the round resolves it is locked — adaptation happens forward (the next round), never backward. ---
  | { kind: "comp-round"; by: EntityId; comp: "hoh-competition" | "veto-competition"; round: number; stillIn: EntityId[]; binding: boolean }
  // --- "Houseguest's Choice" (0046/B45): the player drew the chip and picks the sixth veto player ---
  | { kind: "houseguests-choice"; by: EntityId; options: EntityId[] }
  | { kind: "replacement"; by: EntityId; saved: EntityId; options: EntityId[] }
  | { kind: "eviction-vote"; by: EntityId; nominees: [EntityId, EntityId] }
  // --- player-HOH tie-break (0046/B44): the player breaks a tied eviction vote ---
  | { kind: "tie-break"; by: EntityId; nominees: [EntityId, EntityId] }
  // --- Final 3 (0045): the final HOH personally evicts one of the other two ---
  | { kind: "final-eviction"; by: EntityId; options: [EntityId, EntityId] }
  // --- eviction night (0047/E34): the player's own goodbye message to the evictee ---
  | { kind: "goodbye-message"; by: EntityId; evictee: EntityId; tones: GoodbyeTone[] }
  // --- finale (0037) ---
  | { kind: "finale-statement"; by: EntityId }
  | { kind: "finale-answer"; by: EntityId; juror: EntityId; appeals: FinaleAppeal[] }
  // --- finale (0037/E37): the player-JUROR's own question to a finalist (scoreless free text) ---
  | { kind: "juror-question"; by: EntityId; finalist: EntityId }
  | { kind: "juror-vote"; by: EntityId; finalists: [EntityId, EntityId] }
  // --- self-eviction (0061): the player-level/OOC confirmation to voluntarily walk out / quit. It is
  // raised by an intent-to-leave and lives ALONGSIDE (never overriding) a ceremony pending, so it is
  // legal at any beat and corrupts no in-flight ceremony. Only an explicit confirm resolves it. ---
  | { kind: "self-evict"; by: EntityId };

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

/**
 * The live STAGED competition sub-state machine (0006 staged-rounds evolution). An endurance-style
 * comp is a sequence of ELIMINATION rounds over the still-in field until one remains (the winner).
 * Each round, if the player is still in, the loop PAUSES for their per-round approach
 * (compete/play-safe/throw) — committed BEFORE the round resolves, then locked (anti-sycophancy:
 * adaptation is forward-only, never a retroactive re-label). The engine resolves each round from the
 * structured selection (never prose), eliminates the lowest-scoring houseguest, and re-asks as the
 * field narrows. NPCs choose their per-round approach by soul motivation (relationship-driven, as
 * comp decisions already are; for now: always compete). Persisted + restart-safe (0030). Vault-free
 * by construction (ids only; no score, lean, or hidden number is ever stored here).
 */
export interface CompetitionProgress {
  /** Which competition this stages — for the resume after a per-round pause + the right beat transition. */
  comp: "hoh-competition" | "veto-competition";
  /** The competition type (0006/0042) — the resolution math's governing aptitude. */
  type: CompetitionType;
  /** The FULL original field that began the comp — surfaced on the crown event so the existing
   *  comp-loss inflection (the contested field) is preserved (engine bookkeeping; public ceremony fact). */
  field: EntityId[];
  /** Who is STILL IN (the field this round competes over). Shrinks by one each resolved round. */
  stillIn: EntityId[];
  /** 1-based round counter — drives the per-round seeded rng fork (restart-stable) + the decision surfaced. */
  round: number;
  /** The houseguests eliminated so far, in drop order (engine bookkeeping; never crosses the wall). */
  eliminated: EntityId[];
  /**
   * The CALIBRATED winner of this competition (anti-sycophancy, the 0006 single-outcome authority).
   * The outcome is decided ONCE, up front, by the EXACT pre-staging single-shot resolution: the comp
   * def is drawn and `resolveCompetition` rolls over the FULL field directly on the fresh per-beat rng,
   * with the player's committed approach — BYTE-IDENTICAL to the non-staged model for the same seed,
   * so the full game trajectory (every winner, eviction, jury reach) is unchanged. The staged rounds
   * are a RE-TELLING of this outcome; they can never overturn it. Set the moment the comp resolves.
   */
  winner?: EntityId;
  /**
   * The pre-computed VISIBLE ELIMINATION ORDER of the LOSERS (everyone but `winner`), the drop drama —
   * derived PURELY from the single roll's scores (`eliminationOrder`, consuming ZERO randomness), so it
   * can never perturb the winner OR any downstream seeded roll. The per-round loop reveals one entry at a
   * time; `winner` is never in this list, so the crown survives every round by construction. Empty until
   * the outcome is decided.
   */
  dropOrder?: EntityId[];
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
   * Self-eviction (0061). `selfEvictPending` = the OOC confirmation is raised and awaiting the
   * player's explicit confirm/cancel — it changes NO game state and lives ALONGSIDE any ceremony
   * `pending` (it never overrides one, so it is legal at any beat and corrupts no ceremony, §4.6).
   * `selfEvicted` = a confirmed walk-out resolved: the player forfeits and EXITS ENTIRELY (owner
   * decision #1 — terminal, never a juror's seat), so the seat read is forced to "evicted" by phase.
   * Both persist with the season (0030). ENGINE-ONLY booleans — no number/hidden state, Vault-free.
   */
  selfEvictPending?: boolean;
  selfEvicted?: boolean;
  /**
   * How each evictee read the manner of their eviction toward each responsible houseguest
   * (0037): mannerByEvictee[evictee][responsible]. Recorded live at each eviction so jury
   * management has genuine effect at the finale. ENGINE-ONLY: never crosses the wall.
   */
  mannerByEvictee?: Record<EntityId, Record<EntityId, EvictionManner>>;
  /**
   * The accumulated JURY-HOUSE grudge adjustment (feature 0100): juryGrudge[juror][finalist] is the
   * BOUNDED (0..`JURY_HOUSE.adjustmentCap`), MONOTONIC amount the sequestered jury house has hardened
   * this juror's hidden read of the responsible finalist — what a grievance, spread juror-to-juror in
   * the room the player can't enter, did to it AFTER the snapshot frozen at eviction. Consumed at the
   * finale by `edgeAsJuryRel` ALONGSIDE the recorded manner: it lowers the juror's bond read of that
   * finalist, sized UNDER the manner lean so it DEEPENS (never swamps) jury management. ENGINE-ONLY:
   * never crosses the wall — the player feels it only as a colder juror and a vote that breaks. Absent
   * unless `ORWELL_JURY_HOUSE` is enabled and a grievance diffused ⇒ byte-identical to the pre-feature
   * vote (the grudge is computed on a DEDICATED rng; off ⇒ no draw, no grudge). Persisted with the
   * season (rides on this `live` state), so a restored mid-jury game resumes with the bitterness intact.
   */
  juryGrudge?: Record<EntityId, Record<EntityId, number>>;
  /**
   * The per-week eviction ballot record (E12): who voted to evict whom, kept ENGINE-ONLY for
   * manner/deal reconciliation and for the 0048 retrospective UNSEALING. Eviction votes are
   * secret ballots in Big Brother — no projection attributes a weekly vote to its voter while
   * the season lives; the attribution surfaces only through the post-season retrospective.
   */
  voteRecord?: Array<{ week: number; evictee: EntityId; voteOf: Record<EntityId, EntityId> }>;
  /**
   * The in-progress STAGED competition sub-loop (0006 staged-rounds evolution); set while an
   * endurance-style HOH/veto comp plays out its elimination rounds, cleared when a winner remains.
   */
  competition?: CompetitionProgress;
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
  /**
   * Each houseguest's GAME RESUME — a public-facts tally (HOH reigns + veto wins) the finale jury
   * weighs as "who played harder" (the gameRespect term, ruling 2026-06-11). Engine-internal
   * bookkeeping of already-broadcast events; persisted (0030); legacy saves default to empty.
   */
  resume?: Record<EntityId, number>;
  /** This week's drawn veto comp (def id) — held across a Houseguest's-Choice pause so the resume runs the SAME comp. */
  vetoComp?: string;
  /**
   * The in-game TIME OF DAY (ADR 0006). OPTIONAL by design: the pure seeded sims + legacy saves omit
   * it, and when absent the clock simply isn't running — every outcome is BYTE-IDENTICAL (the golden
   * calibration spine never reads it). Advanced by PLAY on the live turn path; reset to morning when a
   * new day begins. Public, Vault-free.
   */
  timeOfDay?: TimeOfDay;
  /**
   * Sleep bookkeeping (ADR 0006), ENGINE-ONLY (no number crosses the wall). `playerRetired` = the
   * player chose to turn in for the night (NEVER auto-set — §Principle 6), cleared at the new day.
   * `lastSleepPhase` = the latest phase the player was effectively up to last night — it drives their
   * OWN rest cue today and their hidden comp deficit (`restOf`). Persist with the season (0030).
   */
  playerRetired?: boolean;
  lastSleepPhase?: TimeOfDay;
  /**
   * Continuous "night depth" (0066 Phase-2, gated): the hidden 0..1 position the public `timeOfDay`
   * is PROJECTED from (`phaseForDepth`). `nightDepth` advances by play; `lastSleepDepth` = how deep into
   * last night the player was effectively up (drives the GRADED comp deficit + their rest cue). Absent ⇒
   * the clock isn't running ⇒ 0 ⇒ byte-identical to the pre-feature model. Persist with the season (0030).
   */
  nightDepth?: number;
  lastSleepDepth?: number;
  /** 0066 Phase-2: the COMPOUNDING multi-night fatigue meter (0..1) — an EMA of nightly deficits, so a
   *  STRING of late nights wears a houseguest down beyond the single-night cost. Persisted (0007/0030 —
   *  non-degradation); absent ⇒ 0 ⇒ byte-identical when the clock is off. `npcFatigue` is keyed by id. */
  playerFatigue?: number;
  npcFatigue?: Record<EntityId, number>;
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
   * The houseguest's hidden REST deficit (0..1) entering a competition (ADR 0006): staying up into
   * late-night the night before a comp dulls performance — the social game pays for its scheming, the
   * comp-focused protect their sleep. Optional — omitted ⇒ 0, so the outcome (and the whole seeded
   * calibration spine) is BYTE-IDENTICAL to the pre-feature model. ENGINE-ONLY: never crosses the wall.
   */
  restOf?: (id: EntityId) => number;
  /**
   * The houseguest's derived LOYALTY (0043: disposition × soul state). When present, decisions
   * gain the emergent BLOC term — bloc-mates shield each other and vote together, scaled by the
   * bloc's loyalty strength. Optional: pure tests omit it and the loop stays byte-stable. The
   * blocs themselves are recomputed every read and NEVER stored (decision 0002).
   */
  loyaltyOf?: (id: EntityId) => number;
  /**
   * 0107 — the NAMED-ALLIANCE cement fed into bloc detection: a bounded boost to a pair's mutual bond
   * when they share a named alliance. Optional: omitted ⇒ 0 for every pair ⇒ the bloc read (and the
   * votes it bends) is BYTE-IDENTICAL — the calibration spine holds when no alliances exist.
   */
  allianceTie?: (a: EntityId, b: EntityId) => number;
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
  /**
   * 0085 — the per-listener CAMPAIGN tilt: the summed, CHARACTER-mediated push (`campaignTilt` =
   * persuasiveness(owner) × susceptibility(voter) × trust × progress) from campaigns to EVICT `target`
   * that `voter` is AWARE of (on a pathway — the symmetric-perspective spine). A sustained, well-pitched
   * campaign raises its target's eviction odds; the engine TALLIES it, narration only voices it
   * (anti-sycophancy). Optional: omitted ⇒ 0, so the seeded vote — and the whole `juryReach` calibration
   * spine — is BYTE-IDENTICAL to the pre-feature model. ENGINE-ONLY (a bounded number; never crosses the
   * wall). Wired only by the LIVE adapter (Phase B2); the calibration/UAT harness leaves it unset, so
   * campaigns never shift the baseline gates.
   */
  campaignTiltFor?: (target: EntityId, voter: EntityId) => number;
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
  // --- STAGED competition round (0006 staged-rounds evolution): the player's approach for THIS round ---
  | { kind: "comp-round"; intent: Intent }
  | { kind: "houseguests-choice"; pick: EntityId }
  | { kind: "replacement"; replacement: EntityId }
  | { kind: "eviction-vote"; vote: EntityId }
  | { kind: "tie-break"; evict: EntityId }
  | { kind: "final-eviction"; evict: EntityId }
  // --- eviction night (E34): the tone is the player's CHOICE; the prose is the model's to voice ---
  | { kind: "goodbye-message"; tone: GoodbyeTone; message?: string }
  // --- finale (0037) ---
  | { kind: "finale-statement"; statement: string }
  | { kind: "finale-answer"; appeal: FinaleAppeal }
  // --- finale (E37): scoreless free text — the juror's moment, never a tally input ---
  | { kind: "juror-question"; question?: string }
  | { kind: "juror-vote"; vote: EntityId }
  // --- self-eviction (0061): ONLY `confirmed:true` executes the irreversible walk-out (§4.2) ---
  | { kind: "self-evict"; confirmed: boolean };

/** Draw this week's competition from the curated library (0042) — seeded, no immediate repeats. */
const drawFor = (s: LiveSeasonState, phase: CompetitionPhase, rng: RandomnessSource): CompetitionDef =>
  drawCompetition(phase, s.week, rng, s.compHistory?.[phase] ?? []);

/** Record a resolved draw into the persisted history (0030) — what the NEXT draw must avoid. */
function recordDraw(s: LiveSeasonState, phase: CompetitionPhase, def: CompetitionDef): void {
  (s.compHistory ??= { hoh: [], veto: [] })[phase].push(def.id);
}

/** The eligible HOH field (Final 3 lifts the outgoing-HOH restriction — everyone plays). */
function hohField(s: LiveSeasonState, ctx: SeasonCtx): EntityId[] {
  const finalThree = s.active.length === 3;
  return eligibleForHOH(weekState(s, ctx), finalThree ? { specialAllowsOutgoingHoh: true } : undefined);
}

/**
 * Resolve a competition with the EXACT pre-staging single-shot RNG consumption — the def is drawn
 * (one rng draw) then `resolveCompetition` rolls over the full field DIRECTLY on the beat rng. This
 * is BYTE-IDENTICAL to the non-staged model for the same seed/field, so the crown (and therefore the
 * whole downstream game trajectory) is unchanged: the staged rounds are pure presentation over it.
 *
 * Returns the drawn def, the field (original order), and the full `CompetitionResult` (winner +
 * scores) — the scores feed the PURE, zero-rng `eliminationOrder` that drives the visible drop drama.
 */
function resolveComp(
  field: EntityId[], def: CompetitionDef, ctx: SeasonCtx, rng: RandomnessSource, playerApproach: Intent,
): CompetitionResult {
  return resolveCompetition(competitorsOf(field, ctx), def.type, roundIntents(field, ctx, playerApproach), rng);
}

/**
 * The HOH competition outcome, NON-mutating — the eligible field + the engine-decided winner, drawn
 * with the baseline RNG pattern (def draw then resolve). `peekCompetition`/`runCompetition` reuse this
 * to PREVIEW the same crown the loop commits (single authority, B37), with the player competing (the
 * preview default; the committed approach is folded into the live crown when the comp resolves).
 */
function resolveHoh(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource, playerApproach: Intent = "compete"): { def: CompetitionDef; field: EntityId[]; result: CompetitionResult } {
  const def = drawFor(s, "hoh", rng);
  const field = hohField(s, ctx);
  return { def, field, result: resolveComp(field, def, ctx, rng, playerApproach) };
}

/**
 * Resolve the HOH competition beat — a STAGED elimination (0006 staged-rounds evolution) that is a
 * PRESENTATION-ONLY re-telling of the single calibrated outcome. The comp is resolved ONCE (the moment
 * the player commits their approach, or immediately when they aren't in the field) with the baseline
 * RNG consumption, then the field narrows one houseguest at a time until the crowned winner stands.
 * Pauses for the player's per-round approach (`comp-round`) BEFORE the staged outcome resolves; that
 * first approach is the binding intent the single roll honors (anti-sycophancy, committed-before).
 */
function resolveHohBeat(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent | null {
  if (!s.competition) {
    const field = hohField(s, ctx);
    // Anti-sycophancy: the player commits their approach BEFORE the comp resolves. If they are in the
    // field and have not committed one, pause for round 1 (no rng consumed — exactly the baseline pause).
    if (field.includes(ctx.player) && s.compIntent === undefined) {
      s.pending = { kind: "comp-round", by: ctx.player, comp: "hoh-competition", round: 1, stillIn: [...field], binding: true };
      return null;
    }
    // Resolve ONCE with the baseline RNG pattern (byte-identical crown), then stage the reveals. The
    // committed `s.compIntent` (round 1's approach) is NOT cleared here — `advanceCompetition` consumes
    // it as round 1's expression and reveals the first drop, so round 1 is asked exactly once.
    const def = drawFor(s, "hoh", rng);
    const result = resolveComp(field, def, ctx, rng, s.compIntent ?? "compete");
    recordDraw(s, "hoh", def); // committed for the week — the next hoh draw avoids it (0042)
    s.vetoComp = undefined;
    s.competition = beginStaged("hoh-competition", def.type, field, result);
  }
  return advanceCompetition(s, ctx);
}

/**
 * Resolve the veto competition beat — STAGED exactly like the HOH beat (the chip-draw ceremony, E35,
 * still precedes it). Presentation-only over the single calibrated outcome; crowns the Power of Veto.
 */
function resolveVetoComp(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent | null {
  if (!s.competition) {
    const field = s.vetoField!;
    if (field.includes(ctx.player) && s.compIntent === undefined) {
      s.pending = { kind: "comp-round", by: ctx.player, comp: "veto-competition", round: 1, stillIn: [...field], binding: true };
      return null;
    }
    // The SAME comp drawn at stage A (0042) — looked up, never re-drawn (restart-safe, 0030).
    const def = (s.vetoComp ? competitionById(s.vetoComp) : undefined) ?? drawFor(s, "veto", rng);
    const result = resolveComp(field, def, ctx, rng, s.compIntent ?? "compete");
    recordDraw(s, "veto", def); // committed for the week — the next veto draw avoids it (0042)
    // `s.compIntent` (round 1's approach) carries into advanceCompetition as round 1's expression.
    s.competition = beginStaged("veto-competition", def.type, field, result);
  }
  return advanceCompetition(s, ctx);
}

/** Build the staged sub-state from the ALREADY-RESOLVED outcome: winner fixed, drop order derived
 *  PURELY from the roll's scores (zero rng), so the reveals can never perturb anything (PR #395). */
function beginStaged(
  comp: "hoh-competition" | "veto-competition", type: CompetitionType, field: EntityId[], result: CompetitionResult,
): CompetitionProgress {
  return {
    comp, type, field: [...field], stillIn: [...field], round: 1, eliminated: [],
    winner: result.winner, dropOrder: eliminationOrder(field, result),
  };
}

/**
 * Staged-competition pacing (audit 2026-06-20, owner ruling): an endurance comp reveals its drops in
 * FEWER, BIGGER rounds — roughly this many rounds total regardless of field size — instead of one drop
 * per round (which made a 15-player HOH a ~14-round slog, repeated for the veto every week). The batch
 * size is sized so the round count lands near this target; small fields (a six-player veto) stay near
 * one drop per round, which is already inside the 4-8 band. Tunable.
 */
const STAGED_TARGET_ROUNDS = 5;

/** Drops to reveal per staged round so a comp resolves in ~STAGED_TARGET_ROUNDS rounds (≥1). */
function stagedBatchSize(fieldSize: number): number {
  return Math.max(1, Math.ceil((fieldSize - 1) / STAGED_TARGET_ROUNDS));
}

/**
 * Staged-eviction-reveal pacing (live-verify 2026-06-27, mirrors the staged-comp ruling above): a
 * 14-voter eviction read one ballot per `advanceGame` is a ~14-advance slog of mostly-empty
 * "producers deliberating" beats — and that flood of inert beats lets the narration model race ahead
 * of the engine and pre-announce the result. Instead the votes are revealed in FEWER, BIGGER batches —
 * roughly this many rounds total — so a big eviction lands in ~4-8 reveal beats. A small ballot set (a
 * Final-3/4 two-or-three-vote eviction) stays at one ballot per round, already inside the band. Like the
 * comp staging this is PRESENTATION ONLY: the same seeded reveal ORDER, the same precomputed tally, the
 * same evictee on the same last ballot, and ZERO randomness consumed — only how many ballots a single
 * advance reveals changes. Tunable.
 */
const STAGED_EVICTION_TARGET_ROUNDS = 5;

/** Ballots to reveal per staged eviction round so the votes stage resolves in ~target rounds (≥1). */
function stagedEvictionBatchSize(voteCount: number): number {
  return Math.max(1, Math.ceil(voteCount / STAGED_EVICTION_TARGET_ROUNDS));
}

/**
 * The anonymized summary of the ballots read in ONE batched reveal round (E12: names the nominee a
 * ballot evicts, NEVER the voter, and never a cumulative tally or the evictee). One ballot reads as the
 * familiar "a vote to evict X"; a batch reads "N votes to evict X" per nominee touched this round.
 */
function batchedRevealContent(e: EvictionProgress, from: number, to: number): string {
  const counts: Record<EntityId, number> = {};
  for (let i = from; i < to; i++) {
    const votedFor = e.voteOf[e.revealOrder[i]!]!;
    counts[votedFor] = (counts[votedFor] ?? 0) + 1;
  }
  // Preserve the nominee order for a stable, deterministic phrasing.
  const parts: string[] = [];
  for (const nominee of e.nominees) {
    const n = counts[nominee];
    if (!n) continue;
    parts.push(n === 1 ? `a vote to evict ${nominee}` : `${n} votes to evict ${nominee}`);
  }
  return parts.join(", ");
}

/**
 * Advance the staged competition ONE step (0006 staged-rounds evolution) — PRESENTATION ONLY. The
 * outcome (winner + drop order) is already fixed; this reveals one elimination at a time, narrowing
 * the field, and pauses for the player's per-round approach (`comp-round`) when they are STILL IN. That
 * per-round approach is recorded as EXPRESSION (committed before each reveal, locked after, forward-
 * only); it can never change the already-decided outcome — anti-sycophancy preserved, and the engine
 * beat/RNG stream is byte-identical to the non-staged model (it consumes NO randomness here). When one
 * houseguest remains, crown them (HOH / veto holder) and transition the beat.
 */
function advanceCompetition(s: LiveSeasonState, ctx: SeasonCtx): BeatEvent | null {
  const c = s.competition!;
  // The crowned winner stands alone — crown them.
  if (c.stillIn.length <= 1) return crownCompetition(s);
  // The player commits an approach for THIS round before its reveal (expression; locked after). If
  // they are still in and have not committed one, pause and surface the narrowed still-in field. Only
  // the FIRST approach (round 1, asked in resolveHohBeat/resolveVetoComp) is the BINDING intent the
  // single roll honored; these later rounds are non-binding FLAVOR (the outcome is already fixed), so
  // they carry `binding: false` and the surface presents them as color, not a stakes decision (#380
  // audit 2026-06-20).
  if (c.stillIn.includes(ctx.player) && s.compIntent === undefined) {
    s.pending = { kind: "comp-round", by: ctx.player, comp: c.comp, round: c.round, stillIn: [...c.stillIn], binding: false };
    return null;
  }
  s.compIntent = undefined; // the round's approach is consumed + LOCKED — the next round re-asks
  // Reveal a BATCH of the scheduled drops this round — FEWER, BIGGER rounds (audit 2026-06-20 owner
  // ruling: ~4-8 rounds per comp, not one drop per round which made a 15-player HOH a ~14-round slog).
  // PRESENTATION ONLY: the winner and the full drop ORDER are unchanged (still the single up-front
  // roll), so the trajectory/calibration is byte-identical — only how many drops group per reveal
  // changes. The winner is never in `dropOrder`, so the crown survives every batch by construction.
  const remaining = c.dropOrder!.length - c.eliminated.length;
  const batch = Math.min(stagedBatchSize(c.field.length), remaining);
  const droppedThisRound: EntityId[] = [];
  for (let i = 0; i < batch; i++) {
    const dropped = c.dropOrder![c.eliminated.length]!;
    c.stillIn = c.stillIn.filter((id) => id !== dropped);
    c.eliminated.push(dropped);
    droppedThisRound.push(dropped);
  }
  c.round += 1;
  if (c.stillIn.length === 1) return crownCompetition(s);
  return {
    // A per-round DROP — NOT the crown (which keeps the comp beat key so its consequence still folds).
    // `comp-elimination` falls through every commit side-effect switch (no fold, no soul inflection, no
    // confessional, no rng) — so a reveal is inert to the game state, keeping the trajectory unchanged.
    beat: "comp-elimination",
    content: droppedThisRound.length === 1
      ? `${droppedThisRound[0]} is eliminated; ${c.stillIn.length} remain`
      : `${droppedThisRound.join(", ")} are eliminated; ${c.stillIn.length} remain`,
    participants: [...droppedThisRound, ...c.stillIn],
  };
}

/** The crowned winner stands alone (HOH / veto holder); the beat transitions + the resume is credited. */
function crownCompetition(s: LiveSeasonState): BeatEvent {
  const c = s.competition!;
  // The CALIBRATED winner — the up-front single-roll crown (byte-identical to the non-staged model). A
  // trivial one-competitor field never decided an outcome — fall back to the lone id.
  const winner = c.winner ?? c.stillIn[0]!;
  s.competition = undefined;
  s.compIntent = undefined;
  creditResume(s, winner); // a broadcast win — the jury's gameRespect read counts it (2026-06-11)
  if (c.comp === "hoh-competition") {
    const finalThree = s.active.length === 3;
    s.hoh = winner;
    s.beat = finalThree ? "final-eviction" : "nominations"; // Final 3 (0045) skips noms/veto
    return {
      beat: "hoh-competition",
      content: `${winner} wins ${finalThree ? "the final Head of Household" : "Head of Household"}`,
      participants: [winner],
    };
  }
  s.vetoHolder = winner; s.beat = "veto-ceremony";
  // The crown event carries the FULL field in its ORIGINAL draw order (the participants) so the
  // contested-loss soul inflection (evolveFromBeat's veto case) fires for the whole six, byte-identically
  // to the single-shot model (whose event was `participants: field`). Order matters: the inflect/fold
  // paths must consume identically to keep the diversity-isolation golden stream byte-stable.
  return { beat: "veto-competition", content: `${winner} wins the Power of Veto`, participants: [...c.field] };
}

/**
 * Stage A of the veto beat (E35): the chip draw is a WITNESSED ceremony of its own — the player
 * experiences who plays and who held Houseguest's Choice, before any winner exists. Stores the
 * drawn comp + the field; the competition itself resolves on a later advance (`resolveVetoComp`),
 * after any player intent declaration. Pauses (pending set, event still returned) when the
 * PLAYER drew the Houseguest's Choice chip (B45).
 */
function resolveVetoDraw(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent {
  // The comp is drawn FIRST (one rng draw) and held in `vetoComp` so every later stage —
  // including a restart mid-pause (0030) — resolves the SAME drawn competition (0042).
  const def = drawFor(s, "veto", rng);
  s.vetoComp = def.id;
  const draw = vetoParticipants(weekState(s, ctx), rng, {
    houseguestsChoiceChip: true,
    choose: (holder, cands) => ctx.rel.chooseStrongestBond(holder, cands, rng),
    playerChoosesOwn: ctx.player, // the player picks their own sixth player; the engine never reads their bonds
  });
  s.vetoField = draw.participants;
  const hc = draw.houseguestsChoice;
  if (hc && hc.picked === undefined) {
    // The player drew Houseguest's Choice (B45): the draw is still a witnessed beat — the five
    // drawn players and the chip in the player's hand are public — and the loop pauses for THEM
    // to name the sixth. The candidates were snapshotted AFTER the full draw (C1).
    s.pending = { kind: "houseguests-choice", by: ctx.player, options: hc.candidates };
    return {
      beat: "veto-draw",
      content: `the veto players are drawn: ${draw.participants.join(", ")} — ${hc.holder} draws Houseguest's Choice and will name the sixth houseguest to play`,
      participants: [...draw.participants],
    };
  }
  const hcNote = hc?.picked !== undefined
    ? ` — ${hc.holder} draws Houseguest's Choice and picks ${hc.picked}`
    : "";
  return {
    beat: "veto-draw",
    content: `the veto players are drawn: ${draw.participants.join(", ")}${hcNote}`,
    participants: [...draw.participants],
  };
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
  // If the staged comp is ALREADY in progress, the outcome is fixed — the preview reports the SAME
  // crown the loop will reveal (single authority, B37). The drop reveals never move it.
  if (s.competition?.winner) {
    const c = s.competition;
    const def = competitionDefFor(s, c);
    if (!def) return null;
    return { beat: c.comp, type: c.type, def, field: [...c.field], winner: c.winner! };
  }
  // The comp has NOT resolved yet: preview the crown with the player COMPETING (the default — `advance`
  // crowns the same one when the player competes), replaying the exact baseline RNG consumption from a
  // fresh position-zero stream (def draw then resolve), so the preview and the live crown agree exactly.
  if (s.beat === "hoh-competition") {
    const { def, field, result } = resolveHoh(s, ctx, rng);
    return { beat: s.beat, type: def.type, def, field, winner: result.winner };
  }
  if (s.beat === "veto-competition") {
    // E35: before the chips are drawn there IS no field — nothing to preview (the draw is a
    // witnessed ceremony of its own). Once drawn, the preview replays the comp exactly: the same
    // stored comp over the same completed field, with no def draw (it was drawn at stage A).
    if (!s.vetoField || !s.vetoComp) return null;
    const def = competitionById(s.vetoComp);
    if (!def) return null;
    return { beat: s.beat, type: def.type, def, field: s.vetoField, winner: resolveComp(s.vetoField, def, ctx, rng, "compete").winner };
  }
  return null;
}

/** The library def backing an in-progress staged competition — the LAST recorded draw for its phase. */
function competitionDefFor(s: LiveSeasonState, c: CompetitionProgress): CompetitionDef | undefined {
  const phase: CompetitionPhase = c.comp === "hoh-competition" ? "hoh" : "veto";
  const recent = s.compHistory?.[phase] ?? [];
  const last = recent[recent.length - 1];
  return last ? competitionById(last) : undefined;
}

export function newLiveSeason(active: EntityId[]): LiveSeasonState {
  return {
    week: 1, beat: active.length > 2 ? "hoh-competition" : "finale",
    active: [...active], vetoUsed: false, evictionOrder: [], finished: false,
  };
}

// --- Staged (endurance-style) competition: visible elimination rounds (0006 staged-rounds evolution) ---
//
// FULL-TRAJECTORY outcome-neutrality (the anti-sycophancy backstop, mandate #3 + the jury calibration
// band, PR #395): the staged rounds are a PRESENTATION-ONLY re-telling of the single-shot 0006 outcome.
// The comp resolves ONCE with the EXACT pre-staging RNG consumption (def draw then `resolveCompetition`
// directly on the beat rng), so the crown — and therefore EVERY downstream HOH/veto winner, nomination,
// eviction, eviction order, and who reaches jury — is BYTE-IDENTICAL to the non-staged model. The drop
// ORDER of the losers is the only new drama, derived PURELY from that roll's scores (`eliminationOrder`,
// consuming ZERO randomness), and the per-round reveals + the player's per-round approach (recorded as
// expression, committed-before/locked-after) consume no rng and mutate no game state — so nothing the
// staging adds can perturb the seeded trajectory.

/**
 * Build the competitor `CompetitionIntents` applying the player's approach. The math is verbatim
 * 0006/0028: stat-vs-type + bounded temperature + the LIVE soul emotional modifier (0041) + the declared
 * intent penalties (0028). NPCs compete (their approach is soul-motivated; for now they always compete,
 * matching the single-shot model's NPC path). The player is declared even when not in the field — it is
 * harmless (never read for a non-competitor) and keeps the resolution byte-identical to the baseline.
 */
function roundIntents(field: readonly EntityId[], ctx: SeasonCtx, playerApproach: Intent): CompetitionIntents {
  const intents = new CompetitionIntents();
  intents.declare(ctx.player, playerApproach);
  return intents;
}

/** The competitor projection (LIVE soul emotional modifier 0041 + hidden rest deficit, ADR 0006) the 0006 resolve reads. */
function competitorsOf(field: readonly EntityId[], ctx: SeasonCtx): Competitor[] {
  return field.map((id) => ({
    id, stats: ctx.statsOf(id), emotionalState: ctx.emotionalOf?.(id) ?? 0.5, restPenalty: ctx.restOf?.(id),
  }));
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
/** Tally one broadcast competition win into the holder's game resume (gameRespect, 2026-06-11). */
function creditResume(s: LiveSeasonState, id: EntityId): void {
  s.resume = s.resume ?? {};
  s.resume[id] = (s.resume[id] ?? 0) + 1;
}

/** The house's CURRENT blocs (0043) — derived fresh per decision; [] when loyalty isn't wired. */
function currentBlocs(s: LiveSeasonState, ctx: SeasonCtx): Bloc[] {
  if (!ctx.loyaltyOf) return [];
  return detectBlocs({ rel: ctx.rel, active: s.active, loyaltyOf: ctx.loyaltyOf, ...(ctx.allianceTie ? { tieBoost: ctx.allianceTie } : {}) });
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
 *   − bondKeep × bond(voter → nominee)    — keep your own: voters protect the nominee THEY are bonded to,
 *                                           so the unattached houseguest loses the split (D4/E33 calibration)
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
    blocTerm(blocs, voter, n) +
    // 0085: a campaign to evict `n` that this voter is aware of pushes the vote toward `n` — bounded,
    // character-mediated, engine-tallied. Absent provider ⇒ 0 ⇒ byte-identical (the juryReach spine).
    (ctx.campaignTiltFor?.(n, voter) ?? 0) -
    (dealBound(n) ? V.dealHonorWeight : 0) -
    V.juryManagementWeight * ctx.rel.edge(n, voter).trust -
    V.bondKeepWeight * ctx.rel.bondStrength(voter, n);
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
  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
  // SOC-NEW-1/5: the read is GRADED off the actual edge — its severity tracks the relationship.
  const graded = (t: number): number => MANNER_GRADING.grievanceFloor + (1 - MANNER_GRADING.grievanceFloor) * clamp01(t);
  const { trustBetrayal, threatBlindside } = MANNER_THRESHOLDS;
  if (e.trust > trustBetrayal) {
    // Trusted them, yet they moved against me — the deeper the trust, the deeper the betrayal.
    return { betrayed: true, intensity: graded((e.trust - trustBetrayal) / (1 - trustBetrayal)) };
  }
  if (e.threat < threatBlindside) {
    // Read them as no threat — the more harmless they seemed, the bigger the blindside.
    return { blindsided: true, intensity: graded((threatBlindside - e.threat) / threatBlindside) };
  }
  // A clean, expected move — no grievance. SOC-NEW-5: respect is EARNED by threat (a feared rival
  // earns it; an ignored floater nets ~neutral, not a flat lift), graded from 0 at the blindside line.
  return { respected: true, intensity: clamp01((e.threat - threatBlindside) / (1 - threatBlindside)) };
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

// --- In-game time of day + the player's bedtime lever (ADR 0006) ----------------
//
// Time advances by PLAY, never a wall-clock (§Principle 1), and the clock NEVER interrupts a
// scene — it only marks how late it is getting (§Principle 2). The diegetic bound (the house
// thins as NPCs reach their bedtimes) lives in `awakeSet` (`./timeOfDay`); these helpers move the
// shared clock and the player's own bedtime/rest. All ENGINE-only mutations; no number crosses the
// wall, and an absent `timeOfDay` keeps the seeded sims byte-identical.

/**
 * Advance the clock one phase as the player lingers/plays. The day cycles morning → … → late-night,
 * and once at late-night a further advance WRAPS to a new morning — banking that the player was up to
 * the bitter end (their tiredness today). A new day also clears the retired flag, so the player is
 * awake again unless they choose to turn in. A no-op once the game is over. When the player has
 * already retired, time simply rolls them straight to the next morning (their night is done).
 */
// One beat advances the hidden depth a fraction of a day (not a whole phase), so the public phase rolls
// over several beats — a believable number of scenes fit each part of the day (a partial fix to the
// "time races" lurch), and the depth grades the sleep trade. Tunable; ~14 beats fill a full day.
const NIGHT_DEPTH_STEP = 0.07;

export function advanceClock(s: LiveSeasonState): void {
  if (s.finished) return;
  if (s.playerRetired) { s.nightDepth = 0; s.timeOfDay = DAY_START; s.playerRetired = false; return; }
  if (s.nightDepth === undefined) { s.nightDepth = 0; s.timeOfDay = DAY_START; return; }
  const next = s.nightDepth + NIGHT_DEPTH_STEP;
  if (next >= 1) {
    // A full night passed without the player turning in — they outlasted the whole house (Principle 6
    // is theirs: nobody sent them to bed). They wake the next morning running on empty (depth 1).
    s.lastSleepDepth = 1;
    s.lastSleepPhase = "late-night";
    s.nightDepth = 0;
    s.timeOfDay = DAY_START;
    return;
  }
  s.nightDepth = next;
  s.timeOfDay = phaseForDepth(next);
}

/**
 * The player's bedtime lever (§Principle 6): the player CHOOSES to turn in. Captures the phase they
 * retired at as last night's bedtime (an early night ⇒ rested; outlasting the house into late-night ⇒
 * running on empty), then rolls to the next morning. Never auto-called — only the player's own action
 * fires it. A no-op once the game is over or the player has left.
 */
export function playerTurnIn(s: LiveSeasonState, player: EntityId): void {
  if (s.finished || playerHasLeft(s, player)) return;
  const depth = s.nightDepth ?? 0;
  s.lastSleepDepth = depth;
  s.lastSleepPhase = phaseForDepth(depth); // keep the phase cue coherent (restStatus reads it)
  s.playerRetired = true;
  s.nightDepth = 0;
  s.timeOfDay = DAY_START;
}

/** The player's hidden rest deficit today (0..1) — graded by how deep into last night they were up. */
export function playerRestDeficit(s: LiveSeasonState): number {
  return restDeficitForDepth(s.lastSleepDepth ?? 0);
}

/**
 * An NPC's hidden rest deficit (0..1) — ENG-NEW-1: keyed off the ACTUAL night, not static aptitude.
 *
 * The old model `restDeficitFor(bedtimeFor(stats))` was a pure function of `social − physical`, so a
 * mental/social-leaning houseguest (a night-owl bedtime) carried the MAX penalty in EVERY competition
 * — including the mental comps they should win — regardless of how the night actually went. That is a
 * structural aptitude tax (anti-sycophancy: the engine must not systematically disadvantage an
 * archetype). The deficit now reflects the LATEST DEPTH THE NPC WAS ACTUALLY AWAKE last night — the
 * EARLIER of their CHRONOTYPE bedtime depth and how far the night actually ran (`lastSleepDepth`, which
 * the player's OWN bedtime drives). So a night-owl only pays when the night genuinely ran late (the
 * player kept the house up); on a normal night everyone — owls included — carries little/none, and the
 * mental favorite wins their mental comp cleanly. Now GRADED + chronotype-aware, never a trait penalty.
 */
export function npcRestDeficit(
  s: LiveSeasonState,
  stats: { physical: number; social: number },
  id?: EntityId,
  bedDepthOverride?: number,
): number {
  const bedDepth = bedDepthOverride ?? bedtimeDepthFor(stats, id);
  const nightPeak = s.lastSleepDepth ?? 0;
  return restDeficitForDepth(Math.min(bedDepth, nightPeak));
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

// --- Self-eviction (0061): the player's voluntary walk-out ----------------------

/** True once the player has genuinely left the game — voted/comp'd out, or a confirmed walk-out. */
export function playerHasLeft(s: LiveSeasonState, player: EntityId): boolean {
  return s.evictionOrder.includes(player);
}

/**
 * Step 1 (§4.2): raise the OOC `self-evict` confirmation. Changes NO game state — it does NOT evict,
 * the house never hears it, and it sits ALONGSIDE any ceremony `pending` so it is legal at any beat
 * (§4.6). A no-op once the player has already left. Idempotent.
 */
export function requestSelfEviction(s: LiveSeasonState, ctx: SeasonCtx): void {
  if (s.finished || playerHasLeft(s, ctx.player)) return;
  s.selfEvictPending = true;
}

/** Cancel the confirmation (§4.2): clear it; the player plays on, ACTIVE and unchanged. */
export function cancelSelfEviction(s: LiveSeasonState): void {
  s.selfEvictPending = false;
}

/**
 * Step 2 (§4.1) — execute a CONFIRMED self-eviction. The player walks out: this is a REAL, recorded
 * transition. The present house WITNESSES the departure (the returned BeatEvent's participants); the
 * player is removed through the SAME exit bookkeeping every player exit uses (`removeEvictee` → the
 * 0046 `evictionOrder` door), the resentment manner is recorded so souls fold it (§4.4), and the
 * forfeit flag (`selfEvicted`) marks the EXIT-ENTIRELY terminal seat (owner decision #1 — never a
 * juror's seat). The season ends for the player here: a quit is terminal. Resolved at this SAFE
 * point (the loop's `pending`/`eviction` sub-state is untouched — never mid-ceremony, §4.6).
 *
 * Returns the witnessed `self-eviction` BeatEvent — the adapter records it (non-hidden, player in the
 * witness set) and folds its hidden impact, exactly like any other witnessed beat (§4.1 / 0023).
 */
export function applySelfEviction(s: LiveSeasonState, ctx: SeasonCtx): BeatEvent {
  const player = ctx.player;
  // The active house in the moment the player walks witnesses the departure. (The fold is the
  // PRESENT HOUSE's read of the leaver — relief/shock/shifted threat — done adapter-side, §4.4; it
  // is NOT the evictee-grievance direction of a vote-out, so we don't record an eviction manner here.)
  const present = s.active.filter((h) => h !== player);
  removeEvictee(s, player);            // the 0046 exit door: evictionOrder + remove from the live house
  s.selfEvictPending = false;
  s.selfEvicted = true;                // owner decision #1: forfeit — the seat reads "evicted" by phase
  s.finished = true;                   // a quit ends the player's game — terminal recap (0048) unseals
  s.beat = "complete";
  return { beat: "self-eviction", content: `${player} self-evicts and walks out of the house`, participants: [player, ...present] };
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

/** The legal goodbye tones the PLAYER may choose for their own message (E34). */
export const GOODBYE_TONES: readonly GoodbyeTone[] = ["warm", "respectful", "cold"];

function goodbyeTone(sender: EntityId, evictee: EntityId, ctx: SeasonCtx): GoodbyeTone {
  const e = ctx.rel.edge(sender, evictee);
  if (e.affinity >= 0.6) return "warm";
  if (e.affinity <= 0.35) return "cold";
  return "respectful";
}

/**
 * How a goodbye tone folds into the evictee's read of the sender (feeds jury lean, 0014/0037 §4.2).
 * SOC-NEW-1: the tone is recorded as the `goodbye` field, applied with bounded PRECEDENCE in
 * `mannerLeanOf` — it can soften a grievance toward zero or lift/sting a clean departure, but a warm
 * tone can no longer be ADDED on top to launder a betrayal (the old `{respected}` merge bug).
 */
export function goodbyeMannerFor(tone: GoodbyeTone): EvictionManner {
  return { goodbye: tone };
}

/**
 * The seeded houseguests who leave a goodbye message (from the house remaining after the eviction).
 * E34: the PLAYER is never engine-selected here — the engine must not author the player's goodbye
 * or assert a tone computed from their hidden edge. A surviving player is appended as the LAST
 * sender by `commitStagedEviction`, where the goodbye stage pauses for their own decision.
 */
function selectGoodbyeSenders(s: LiveSeasonState, evictee: EntityId, player: EntityId, rng: RandomnessSource): EntityId[] {
  const remaining = s.active.filter((h) => h !== evictee && h !== player);
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
        // Reveal a BATCH of ballots this advance (live-verify 2026-06-27): one ballot per advance made a
        // 14-voter eviction a ~14-advance slog of inert beats and let the model race ahead of the engine.
        // The batch size is derived from the TOTAL ballot count (stable + restart-safe — no extra state),
        // so the votes stage lands in ~4-8 rounds. PRESENTATION ONLY: the seeded reveal ORDER, the
        // precomputed tally, and the evictee on the LAST ballot are all unchanged; NO randomness here.
        const batch = stagedEvictionBatchSize(e.revealOrder.length);
        const from = e.revealIx;
        const to = Math.min(from + batch, e.revealOrder.length);
        e.revealIx = to;
        // E12: eviction votes are SECRET BALLOTS — the reveal reads the ballot(s), never the voter
        // ("a vote to evict X…" / "N votes to evict X"). `voteOf` stays engine-internal (manner/deal
        // reconciliation); attributions unseal only in the 0048 post-season retrospective. Anonymized
        // and never a cumulative tally or the evictee — `revealedTally` stays revealed-only.
        const participants = e.revealOrder.slice(from, to).map((voter) => e.voteOf[voter]!);
        return { beat: "eviction-reveal", content: batchedRevealContent(e, from, to), participants };
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
        if (sender === ctx.player) {
          // E34: the engine NEVER authors the player's goodbye — no beat fires until the player
          // chooses their own tone (the prose is the model's to voice from that choice).
          s.pending = { kind: "goodbye-message", by: ctx.player, evictee: e.evictee!, tones: [...GOODBYE_TONES] };
          return null;
        }
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
  // E12: the ballots are recorded ENGINE-ONLY for the 0048 retrospective unsealing — the week's
  // secret votes become tellable only once the season is over.
  (s.voteRecord ??= []).push({ week: s.week, evictee, voteOf: { ...e.voteOf } });
  const votesToEvict = Object.entries(e.voteOf).filter(([, t]) => t === evictee).map(([v]) => v);
  recordEvictionManner(s, evictee, [s.hoh!, ...votesToEvict], ctx);
  removeEvictee(s, evictee);          // out now — the last vote landed; the result is public
  e.goodbyeFrom = selectGoodbyeSenders(s, evictee, ctx.player, rng);
  // E34: a SURVIVING player always gets jury management's signature lever — their own goodbye
  // message, last, as a real pending decision (never engine-authored, never engine-toned).
  if (s.active.includes(ctx.player)) e.goodbyeFrom.push(ctx.player);
  e.stage = "goodbye";
  return { beat: "eviction", content: `${evictee} is evicted`, participants: [evictee] };
}

// --- Live finale sub-loop (0037) ----------------------------------------------

/**
 * The juror's directed read of a finalist, as the jury math (0014) wants it. The reliability term
 * is CENTERED on the edge baseline (E54): a juror with no protective track record reads 0 (neutral),
 * demonstrated loyalty reads positive, proven disloyalty negative — `juryLean` weights it below
 * relationship+manner.
 *
 * 0100 — the ACCUMULATED jury-house grudge (`s.juryGrudge[juror][finalist]`, bounded + saturated) is
 * folded in here, ALONGSIDE the recorded manner: it lowers the juror's BOND read (trust + affinity)
 * of the finalist, so a juror the jury house soured on goes in colder than the snapshot at their own
 * eviction implied. This is the ONLY change to the vote path — a richer (still hidden) lean INPUT; the
 * tally/tie-break/reveal are reused verbatim. Absent grudge (the default, or with `ORWELL_JURY_HOUSE`
 * off) ⇒ a zero subtraction ⇒ byte-identical to the pre-feature read. The grudge is sized UNDER the
 * manner lean (`JURY_HOUSE.adjustmentCap < |MANNER_LEAN.betrayed|`), so it DEEPENS jury management,
 * never swamps it. ENGINE-ONLY: no number crosses the wall.
 */
function edgeAsJuryRel(s: LiveSeasonState, juror: EntityId, finalist: EntityId, ctx: SeasonCtx): JuryRel {
  const e = ctx.rel.edge(juror, finalist);
  const grudge = s.juryGrudge?.[juror]?.[finalist] ?? 0;
  const cool = (x: number): number => Math.max(0, Math.min(1, x - grudge));
  return {
    // The grudge cools the bond read toward the finalist (clamped to [0,1]); threat/reliability are
    // unchanged. A colder bond lowers `juryLean`'s relationship term, exactly as a hardened room should.
    trust: cool(e.trust),
    affinity: cool(e.affinity),
    threat: e.threat,
    reliability: e.reliability - RELATIONSHIP_CONSTANTS.baseline.reliability,
  };
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
 * The appeal a finalist made to a juror — their recorded choice, or `undefined` if NONE was made.
 * With the 18-Q&A finale every juror questions BOTH finalists (audit A6 ruling), so in a complete
 * finale every (finalist, juror) pair is answered; an absent appeal means the finalist DID NOT answer
 * that juror (e.g. a player who skipped/abandoned the finale). SOC-NEW-4 (#567): we no longer launder
 * a missing answer into `bestAppeal` (the argmax-OPTIMAL choice) — that scored not-answering as
 * answering perfectly, a player-favoring anti-sycophancy violation. The caller floors a missing appeal.
 */
function appealMade(
  f: FinaleProgress, finalist: EntityId, juror: EntityId,
): FinaleAppeal | undefined {
  return f.appeals[finalist]?.[juror];
}

/**
 * The finale-performance term for a finalist toward a juror. A RECORDED appeal scores by its actual
 * `appealEffect`; an ABSENT appeal (the finalist never answered this juror) scores at the FLOOR — the
 * weakest effect available against this juror, never the argmax-best. So failing to answer can never
 * beat actually answering (SOC-NEW-4 / #567, anti-sycophancy).
 */
function appealPerf(
  f: FinaleProgress, finalist: EntityId, juror: EntityId, ctx: SeasonCtx, s: LiveSeasonState,
): number {
  const rel = edgeAsJuryRel(s, juror, finalist, ctx);
  const manner = mannerFor(s, juror, finalist);
  const made = appealMade(f, finalist, juror);
  if (made !== undefined) return appealEffect(made, rel, manner);
  // No appeal made — score the floor (the worst appeal this juror could have heard), so not-answering
  // is strictly no better than the weakest real answer.
  return Math.min(...FINALE_APPEALS.map((a) => appealEffect(a, rel, manner)));
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
/** The other finalist in the pair. */
function otherFinalist(finalists: [EntityId, EntityId], fin: EntityId): EntityId {
  return finalists[0] === fin ? finalists[1] : finalists[0];
}

function precomputeVotes(s: LiveSeasonState, ctx: SeasonCtx, f: FinaleProgress, rng: RandomnessSource): Record<EntityId, EntityId> {
  const votes: Record<EntityId, EntityId> = { ...(f.votes ?? {}) };
  for (const juror of f.jury) {
    if (votes[juror]) continue; // the player's own vote (recorded interactively) is kept
    const leanFor = (fin: EntityId): number =>
      juryLean(edgeAsJuryRel(s, juror, fin, ctx), mannerFor(s, juror, fin)) +
      // GAME RESPECT (ruling 2026-06-11): jurors weigh who actually PLAYED — the public resume
      // (comp wins) splits the two finalists; a goat with no game starts every juror down a
      // bounded notch. Grievance (manner) can still outvote it: bitter juries stay possible.
      JURY_WEIGHTS.gameRespect * gameRespectTerm(s.resume?.[fin] ?? 0, s.resume?.[otherFinalist(f.finalists, fin)] ?? 0);
    // Each juror questioned BOTH finalists (18-Q&A), so each has a recorded appeal here — scored
    // symmetrically by the same `appealEffect`; the player's own answers are exactly as weighted as the NPC's.
    const perfFor = (fin: EntityId): number => appealPerf(f, fin, juror, ctx, s);
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
      if (q.juror === ctx.player) {
        // E37: the player-JUROR asks their own question (scoreless free text) — their seat at the
        // finale is a real beat, not a spectator slot the engine auto-fills.
        s.pending = { kind: "juror-question", by: ctx.player, finalist: q.finalist };
        return null;
      }
      // NPC finalist answers optimally for this juror (deterministic argmax), recorded for the tally.
      const appeal = bestAppeal(edgeAsJuryRel(s, q.juror, q.finalist, ctx), mannerFor(s, q.juror, q.finalist));
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
    case "hoh-competition":
      // STAGED (0006 staged-rounds evolution): the comp plays out in visible elimination rounds. The
      // sub-loop pauses for the player's PER-ROUND approach (`comp-round`) when they are still in —
      // committed before each round resolves, locked after (anti-sycophancy). No up-front binding popup.
      return resolveHohBeat(s, ctx, rng);
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
      // E35 stage A: the chip draw is a witnessed ceremony of its own — it precedes any winner.
      if (!s.vetoField) return resolveVetoDraw(s, ctx, rng);
      // STAGED (0006 staged-rounds evolution): the veto comp plays out in elimination rounds exactly
      // like the HOH comp — the sub-loop pauses for the player's PER-ROUND approach when they are in
      // the drawn field. The draw (above) always precedes the rounds.
      return resolveVetoComp(s, ctx, rng);
    }
    case "veto-ceremony": {
      const nominees = s.nominees!;
      if (s.vetoHolder === ctx.player) {
        // The holder may save either nominee (incl. self if nominated) — the whole pair is saveable…
        // …UNLESS no legal replacement exists (the Final-4 rule, E36): then "use" is not a real
        // option and the legal set says so up front, instead of accepting a save and silently
        // inverting it into "does not use the veto".
        const saveable = selectableReplacements(weekState(s, ctx)).length > 0 ? [...nominees] : [];
        s.pending = { kind: "veto-decision", by: ctx.player, nominees, saveable };
        return null;
      }
      // NPC veto holder: save self if nominated, else the most save-worthy nominee — trust shaded
      // by demonstrated loyalty (E54), so a proven protector outranks an equally-liked stranger.
      const saved = nominees.includes(s.vetoHolder!)
        ? s.vetoHolder!
        : ctx.rel.chooseVetoSave(s.vetoHolder!, nominees);
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
    content: `${s.vetoHolder} uses the veto on ${s.vetoHolder === s.saved ? "themselves" : s.saved}; ${s.hoh} names ${replacement} as the replacement`,
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
    case "comp-round":
      // The staged per-round approach (0006 staged-rounds): an NPC in the player's seat competes
      // every round (the same default the loop's NPC competitors use — no second rulebook).
      return { kind: "comp-round", intent: "compete" };
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
      // Mirror the NPC veto holder: save self if nominated, else the most save-worthy nominee
      // (trust shaded by demonstrated loyalty, E54) — from the LEGAL saveable set only (empty at
      // Final 4, E36: using the veto is barred).
      const saved = p.saveable.includes(p.by)
        ? p.by
        : ctx.rel.chooseVetoSave(p.by, p.saveable);
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
    case "goodbye-message":
      // The same relationship-derived tone an NPC sender would use (no second rulebook).
      return { kind: "goodbye-message", tone: goodbyeTone(p.by, p.evictee, ctx) };
    case "finale-statement":
      return { kind: "finale-statement", statement: "" };
    case "finale-answer":
      return { kind: "finale-answer", appeal: bestAppeal(edgeAsJuryRel(s, p.juror, p.by, ctx), mannerFor(s, p.juror, p.by)) };
    case "juror-question":
      return { kind: "juror-question", question: "" };
    case "juror-vote": {
      const lean = (fin: EntityId): number => juryLean(edgeAsJuryRel(s, p.by, fin, ctx), mannerFor(s, p.by, fin));
      return { kind: "juror-vote", vote: lean(p.finalists[0]) >= lean(p.finalists[1]) ? p.finalists[0] : p.finalists[1] };
    }
    case "self-evict":
      // 0061: an NPC sitting in the player's seat NEVER voluntarily quits — and the self-evict
      // confirmation never rides `s.pending` (it lives on `selfEvictPending`), so the auto-driver
      // (calibration / admin fast-forward) is never asked to resolve one. Refuse defensively.
      throw new Error("self-eviction is a deliberate player choice — never auto-resolved");
  }
}

/** Apply the player's decision for the current `pending`, then continue to the next beat. */
export function applyDecision(
  s: LiveSeasonState, input: DecisionInput, ctx: SeasonCtx,
  // Only the Houseguest's-Choice resume needs randomness (to run the veto comp once the field completes);
  // the live adapter passes the beat-deterministic rng, so the same seed reproduces the same outcome.
  rng: RandomnessSource = new SeededRandom(1),
): BeatEvent {
  // `comp-intent` and `comp-round` are interchangeable aliases for the staged per-round approach (the
  // live pending is `comp-round`; the legacy/alias input may arrive as either). Every other kind must match.
  const compApproach = (k: string): boolean => k === "comp-intent" || k === "comp-round";
  const matches = s.pending && (s.pending.kind === input.kind || (compApproach(s.pending.kind) && compApproach(input.kind)));
  if (!matches) {
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
      // E36: with no legal replacement (Final 4) "use" is refused with the decision STANDING —
      // never accepted and then silently inverted into "does not use the veto".
      if (input.use && selectableReplacements(weekState(s, ctx)).length === 0) {
        throw new Error("the veto cannot be used — no legal replacement nominee exists, so the nominations stand");
      }
      s.pending = undefined;
      if (!input.use) {
        s.vetoUsed = false; s.finalNominees = [nominees[0], nominees[1]]; s.beat = "eviction";
        return { beat: "veto-ceremony", content: `${ctx.player} does not use the veto`, participants: [ctx.player] };
      }
      s.vetoUsed = true; s.saved = save!;
      // The HOH names the replacement. If the player is ALSO HOH, that's the next decision.
      const ev = resolveReplacement(s, ctx);
      return ev ?? { beat: "veto-ceremony", content: `${ctx.player} uses the veto on ${ctx.player === save ? "themselves" : save}`, participants: [ctx.player, save!] };
    }
    case "comp-intent":
    case "comp-round": {
      // 0006 staged-rounds evolution: the player commits their approach for the CURRENT elimination
      // round (compete / throw / play-safe), seeing who is still in. STRUCTURED selection only — never
      // parsed from prose. It is committed BEFORE the round resolves; resolving locks it (the round can
      // not be re-labeled after). Adaptation is forward-only: the NEXT round re-asks over the still-in field.
      // (`comp-intent` is the legacy alias the FE/tests may still send — same per-round semantics.)
      s.compIntent = input.intent;
      s.pending = undefined;
      // Resume the staged sub-loop: it resolves exactly THIS round (eliminate the lowest), then either
      // pauses again for the next round or crowns the last standing.
      if (s.beat === "hoh-competition") return resolveHohBeat(s, ctx, rng)!;
      // E35: at the veto the field is already drawn (the draw ceremony precedes the rounds) — resolve.
      return resolveVetoComp(s, ctx, rng)!;
    }
    case "houseguests-choice": {
      // The player drew Houseguest's Choice and picks the sixth veto player (B45/audit B4).
      const options = (s.pending as { options: EntityId[] }).options;
      // C1: legality is RE-DERIVED at resume — the pick must be an offered candidate AND must not
      // already stand in the drawn field (a stale offer can never produce a duplicate competitor).
      if (!options.includes(input.pick) || s.vetoField!.includes(input.pick)) {
        throw new Error("the Houseguest's Choice must pick an eligible candidate who is not already drawn");
      }
      s.pending = undefined;
      s.vetoField = [...s.vetoField!, input.pick]; // the player's pick completes the field
      // E35: the completed field is the witnessed beat; the STAGED comp resolves on the NEXT advance,
      // pausing for the player's per-round approach (`comp-round`) inside the sub-loop (0006 staged-rounds).
      return {
        beat: "veto-draw",
        content: `${ctx.player} names ${input.pick} to fill the final veto spot`,
        participants: [...s.vetoField],
      };
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
    case "goodbye-message": {
      // E34: the player's OWN goodbye — the tone is their choice (the engine never computes it
      // from their hidden edge), folded into the evictee's manner EXACTLY as NPC tones are.
      const p = s.pending;
      if (!p || p.kind !== "goodbye-message") throw new Error("no pending goodbye message");
      if (!GOODBYE_TONES.includes(input.tone)) throw new Error("a legal goodbye tone is required (warm / respectful / cold)");
      const e = s.eviction!;
      s.pending = undefined;
      e.goodbyeIx += 1;
      const row = (s.mannerByEvictee![e.evictee!] ??= {});
      row[p.by] = { ...(row[p.by] ?? {}), ...goodbyeMannerFor(input.tone) };
      return {
        beat: "eviction-goodbye",
        content: `${p.by} leaves ${e.evictee} a ${input.tone} goodbye message`,
        participants: [p.by, e.evictee!],
      };
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
    case "juror-question": {
      // E37: the player-juror's question is SCORELESS flavor — recording it changes no tally;
      // the NPC finalist's answer is still engine-chosen exactly as for any juror.
      const f = s.finale!;
      const p = s.pending;
      if (!p || p.kind !== "juror-question") throw new Error("no pending juror question");
      s.pending = undefined;
      const appeal = bestAppeal(edgeAsJuryRel(s, p.by, p.finalist, ctx), mannerFor(s, p.by, p.finalist));
      recordAppeal(f, p.finalist, p.by, appeal);
      f.questionIx += 1;
      return { beat: "finale", content: `${p.by} questions ${p.finalist}; ${p.finalist} answers`, participants: [p.finalist, p.by] };
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
    case "self-evict": {
      // 0061: a confirmed self-eviction does NOT flow through the ceremony-pending machinery (it
      // lives on `selfEvictPending`, alongside any ceremony pending). The adapter executes it via
      // `applySelfEviction` so it never overrides an in-flight ceremony — this seam refuses it, so
      // there is no second exit path through the standard decision rulebook.
      throw new Error("self-eviction is executed through the dedicated confirmed-quit seam, not applyDecision");
    }
  }
}
