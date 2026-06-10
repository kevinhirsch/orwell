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
import { chooseNominationsWithMood, tallyJury } from "./season";
import type { RelationshipModel } from "./relationships";
import {
  runFinale as buildFinaleScript, castJuryVote, juryLean, appealEffect, bestAppeal,
  FINALE_APPEALS, type EvictionManner, type FinaleAppeal, type FinaleScript, type JuryRel,
} from "./jury";
import { MANNER_THRESHOLDS } from "./juryConstants";

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
  // finale sub-loop events (0037) — emitted on BeatEvent only; never a structural `s.beat`.
  | "finale-reveal" | "finale-result";

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

const HOH_TYPES: readonly CompetitionType[] = ["endurance", "mental", "physical"];
const VETO_TYPES: readonly CompetitionType[] = ["puzzle", "social", "memory"];

const hohType = (week: number): CompetitionType => HOH_TYPES[(week - 1) % HOH_TYPES.length]!;
const vetoType = (week: number): CompetitionType => VETO_TYPES[(week - 1) % VETO_TYPES.length]!;

/**
 * Resolve the HOH competition (no state mutation): the eligible field + the engine-decided winner.
 * The SOLE place HOH outcomes are computed — `advance` commits it, `peekCompetition` previews it,
 * both with the same seeded rng, so a narrator's `runCompetition` can never disagree with the loop.
 */
function resolveHoh(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): { field: EntityId[]; winner: EntityId } {
  // Final 3 (0045): the final-HOH competition lifts the outgoing-HOH restriction — everyone plays.
  const finalThree = s.active.length === 3;
  const field = eligibleForHOH(weekState(s, ctx), finalThree ? { specialAllowsOutgoingHoh: true } : undefined);
  return { field, winner: winnerOf(field, hohType(s.week), ctx, rng, s.compIntent ?? "compete") };
}

/** Resolve the Power of Veto competition (no state mutation): the six-player field + the winner. */
/** The veto draw resolves to a winner — UNLESS the player drew Houseguest's Choice, which DEFERS (B45). */
type VetoResolution =
  | { field: EntityId[]; winner: EntityId }
  | { deferred: true; field: EntityId[]; candidates: EntityId[] };

function resolveVeto(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): VetoResolution {
  const draw = vetoParticipants(weekState(s, ctx), rng, {
    houseguestsChoiceChip: true,
    choose: (holder, cands) => ctx.rel.chooseStrongestBond(holder, cands, rng),
    playerChoosesOwn: ctx.player, // the player picks their own sixth player; the engine never reads their bonds
  });
  if (draw.houseguestsChoice && draw.houseguestsChoice.picked === undefined) {
    return { deferred: true, field: draw.participants, candidates: draw.houseguestsChoice.candidates };
  }
  return { field: draw.participants, winner: winnerOf(draw.participants, vetoType(s.week), ctx, rng, s.compIntent ?? "compete") };
}

/** Resolve the HOH competition beat (used by `advance` and the comp-intent resume); consumes the intent. */
function resolveHohBeat(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): BeatEvent {
  const finalThree = s.active.length === 3;
  const { winner: hoh } = resolveHoh(s, ctx, rng);
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
    // intent stays set; the houseguests-choice resume runs the comp with it.
    s.vetoField = r.field;
    s.pending = { kind: "houseguests-choice", by: ctx.player, options: r.candidates };
    return null;
  }
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
  field: EntityId[];
  winner: EntityId;
}
export function peekCompetition(s: LiveSeasonState, ctx: SeasonCtx, rng: RandomnessSource): CompetitionPeek | null {
  if (s.pending || s.finished) return null;
  if (s.beat === "hoh-competition") { const { field, winner } = resolveHoh(s, ctx, rng); return { beat: s.beat, type: hohType(s.week), field, winner }; }
  if (s.beat === "veto-competition") {
    const r = resolveVeto(s, ctx, rng);
    if ("deferred" in r) return null; // the player must pick the sixth player first — no preview yet
    return { beat: s.beat, type: vetoType(s.week), field: r.field, winner: r.winner };
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
/** A voter's threat-driven pick between the two final nominees (decision 0002). */
function npcEvictChoice(voter: EntityId, fn: [EntityId, EntityId], ctx: SeasonCtx): EntityId {
  return ctx.rel.edge(voter, fn[0]).threat >= ctx.rel.edge(voter, fn[1]).threat ? fn[0] : fn[1];
}

/** Count the eviction votes (NPCs threat-driven; the player's own vote, if any) WITHOUT breaking a tie. */
function countEvictionVotes(s: LiveSeasonState, ctx: SeasonCtx, playerVote?: EntityId): {
  fn: [EntityId, EntityId]; votes: Record<EntityId, number>; voteOf: Map<EntityId, EntityId>;
} {
  const fn = s.finalNominees!;
  const voters = evictionVoters({ ...weekState(s, ctx), nominees: fn });
  const votes: Record<EntityId, number> = { [fn[0]]: 0, [fn[1]]: 0 };
  const voteOf = new Map<EntityId, EntityId>();
  for (const v of voters) {
    const target = v === ctx.player && playerVote ? playerVote : npcEvictChoice(v, fn, ctx);
    votes[target]++;
    voteOf.set(v, target);
  }
  return { fn, votes, voteOf };
}

/** Apply an eviction once the evictee is known: record the responsible voters' manner, remove, advance. */
function commitEviction(s: LiveSeasonState, ctx: SeasonCtx, evictee: EntityId, voteOf: Map<EntityId, EntityId>): BeatEvent {
  const votesToEvict = [...voteOf].filter(([, t]) => t === evictee).map(([v]) => v);
  const ev: BeatEvent = { beat: "eviction", content: `${evictee} is evicted`, participants: [evictee] };
  applyEviction(s, evictee, ctx, [s.hoh!, ...votesToEvict]);
  return ev;
}

/**
 * Resolve the eviction from the tally, applying it. On a TIE the HOH breaks it — but if the HOH is the
 * PLAYER, the loop PAUSES on a `tie-break` decision (B44/audit B2): the single most dramatic HOH power
 * must be the player's, never silently decided from hidden player→NPC edges. Returns null when it pends.
 */
function resolveEvictionBeat(s: LiveSeasonState, ctx: SeasonCtx, playerVote?: EntityId): BeatEvent | null {
  const { fn, votes, voteOf } = countEvictionVotes(s, ctx, playerVote);
  let evictee: EntityId;
  if (votes[fn[0]]! > votes[fn[1]]!) evictee = fn[0];
  else if (votes[fn[1]]! > votes[fn[0]]!) evictee = fn[1];
  else {
    if (s.hoh === ctx.player) {
      s.pending = { kind: "tie-break", by: ctx.player, nominees: fn };
      return null; // the player Head of Household casts the deciding vote
    }
    evictee = npcEvictChoice(s.hoh!, fn, ctx); // an NPC HOH breaks the tie
  }
  return commitEviction(s, ctx, evictee, voteOf);
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

/** Remove the evictee and roll into the next week (or the finale at Final 3 → 2). */
function applyEviction(s: LiveSeasonState, evictee: EntityId, ctx: SeasonCtx, responsible: EntityId[]): void {
  recordEvictionManner(s, evictee, responsible, ctx);
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
      // A rattled HOH (low live emotional state, 0041) nominates more erratically; a calm one ranks
      // purely by threat (byte-identical to before). Emotion bends the read — legality still binds.
      const nominees = chooseNominationsWithMood(s.hoh!, s.active, ctx.rel, ctx.emotionalOf?.(s.hoh!) ?? 0.5);
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
      // The player is HOH or a nominee here; resolveEvictionBeat pauses on a tie-break iff player-HOH.
      return resolveEvictionBeat(s, ctx, undefined);
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
  const replacement = [...options].sort((a, b) => ctx.rel.edge(s.hoh!, b).threat - ctx.rel.edge(s.hoh!, a).threat)[0]!;
  s.replacement = replacement; s.finalNominees = [otherNominee(s), replacement]; s.beat = "eviction";
  return {
    beat: "veto-ceremony",
    content: `${s.vetoHolder} uses the veto on ${s.saved}; ${s.hoh} names ${replacement} as the replacement`,
    participants: [s.vetoHolder!, s.saved!, s.hoh!, replacement],
  };
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
      const holder = winnerOf(field, vetoType(s.week), ctx, rng, s.compIntent ?? "compete");
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
      // The player is a voter here ⇒ the HOH is an NPC ⇒ a tie auto-resolves; this never pends.
      return resolveEvictionBeat(s, ctx, input.vote)!;
    }
    case "tie-break": {
      // The player Head of Household breaks a tied eviction vote (B44/audit B2).
      const fn = s.finalNominees!;
      if (!fn.includes(input.evict)) throw new Error("the tie-break must choose a current nominee");
      s.pending = undefined;
      const { voteOf } = countEvictionVotes(s, ctx, undefined); // recover who voted where (the HOH didn't vote)
      return commitEviction(s, ctx, input.evict, voteOf);
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
