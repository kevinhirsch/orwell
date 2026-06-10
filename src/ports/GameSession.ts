import type { EntityId } from "../domain/ids";

/**
 * Vault-free game-session port (onboarding + per-moment prompt injection).
 *
 * The outward MCP server reaches the running game through THIS interface only —
 * every type here is Vault-free by construction, so no outward module gains a
 * Vault handle. Onboarding (`createCharacter`) runs the OOBE and starts a game;
 * `getGameState` returns the public projection; `getMomentPrompt` returns the
 * managed system prompt the front-end injects so the LLM narrates *as the game*
 * (never as a generic assistant) — the persona/framing layer, NOT a secrecy
 * mechanism (the Vault Wall stays structural).
 */

/** The player's own authored card. They authored it, so persona is theirs — but NO numeric stats cross the wall. */
export interface PlayerCard {
  id: EntityId;
  name: string;
  archetype: string;
  strategyStyle: string;
}

/** A public houseguest card: name + status only. No stats, no soul, no archetype, no hidden attributes. */
export interface HouseguestCard {
  id: EntityId;
  name: string;
  status: string;
}

/**
 * A Vault-free projection of a deal the PLAYER is party to (0039): the FACT and status only —
 * parties, kind, terms, kept/open/broken. NEVER a trust/threat number; NPC↔NPC deals never appear.
 */
export interface DealView {
  id: string;
  parties: NamedRef[];
  kind: string;
  terms: string;
  status: "open" | "kept" | "broken";
}

/** The Vault-free projection of the running game the front-end may render. */
export interface GameStateView {
  started: boolean;
  week: number;
  phase: string;
  /** The current beat key (drives which managed prompt fragment is injected). */
  moment: string;
  player: PlayerCard | null;
  house: HouseguestCard[];
  /** Deals the player is party to (0039) — fact + status only, never the hidden opinion numbers. */
  deals?: DealView[];
}

/** The player makes a deal WITH a houseguest (player↔NPC). NPC↔NPC deals are off-screen/Vault-held. */
export interface MakeDealReq {
  with: EntityId;
  kind: "safety" | "vote" | "final-two" | "target-other";
  terms: string;
}

export interface CreateCharacterReq {
  /** The player's authored display name (the only human-authored profile). */
  playerName: string;
  archetype?: string;
  strategyStyle?: string;
  /** Optional seed for a reproducible house; the front-end may send a random one for variety. */
  seed?: number;
  /**
   * Explicit opt-in to REPLACE an already-started game (non-degradation guard, B36/audit A2). Without
   * it, calling `createCharacter` on a started season is a no-op that returns the current state — so a
   * stray/hallucinated/network call can never wipe an active game. A real restart sets this (the admin
   * reset path) — it is NOT part of the player tool's documented schema.
   */
  confirmRestart?: boolean;
}

export interface MomentPromptReq {
  /** Override the phase-derived beat (e.g. "diary-room", "character-creation"). */
  moment?: string;
}

export interface MomentPromptView {
  moment: string;
  /** The composed system prompt to inject for this moment — base persona + beat fragment + Vault-free context. */
  systemPrompt: string;
}

export interface RunCompetitionReq {
  /** Competition type; an unknown/missing value falls back to a sensible default. */
  type?: string;
  /** Optional subset of houseguest ids to compete; defaults to the whole house. */
  participantIds?: EntityId[];
}

/**
 * Vault-free competition outcome: the engine-decided winner (name only). The
 * engine resolves it from the live house's OWN stats — the caller (LLM/front-end)
 * supplies no stats and receives no scores or rankings (anti-sycophancy + Vault Wall).
 */
export interface CompetitionResultView {
  started: boolean;
  type: string;
  week: number;
  phase: string;
  winner: { id: EntityId; name: string } | null;
}

/** Vault-free public status for the status panel (0020): ceremony-level facts only. */
export interface PublicGameStatus {
  week: number;
  phase: string;
  hoh: { id: EntityId; name: string } | null;
  nominees: Array<{ id: EntityId; name: string }>;
  veto: { holder: { id: EntityId; name: string } | null; used: boolean };
}

/** A named houseguest reference for decisions/options (Vault-free — id + name only). */
export interface NamedRef {
  id: EntityId;
  name: string;
}

/** A meaningful weekly-loop beat that just resolved (player-witnessed; names, not ids). */
export interface BeatEventView {
  beat: string;
  content: string;
}

/** A decision the live loop is blocked on until the player resolves it (0011 + the finale, 0037). */
export interface PendingDecisionView {
  kind: "nominations" | "veto-decision" | "replacement" | "eviction-vote" | "final-eviction"
    | "finale-statement" | "finale-answer" | "juror-vote";
  by: NamedRef;
  /** A human-readable instruction for the moment (what the player must choose). */
  prompt: string;
  /**
   * The legal choices (the houseguests the player may pick among). For `finale-statement`
   * this is empty (the statement is free text); for `juror-vote` it is the two finalists.
   */
  options: NamedRef[];
  /**
   * The legal finale APPEALS for a `finale-answer` (Vault-free, name-agnostic enum values);
   * absent for every other decision kind. The engine scores the chosen appeal — never the prose.
   */
  appeals?: string[];
  /** The juror asking, for a `finale-answer` (Vault-free name only); absent otherwise. */
  juror?: NamedRef;
  /** How many to pick (nominations = 2; others = 1; finale-statement = 0). */
  pick: number;
}

/**
 * The Vault-free projection of an in-progress finale (0037). Names + the current stage +
 * the reveals SO FAR only — NEVER a lean, a vote tally, an eviction manner, or the
 * pre-reveal winner. A juror's vote appears here only once it has been revealed in order.
 */
export interface FinaleView {
  /** Which stage the finale is in: statements | questions | vote | reveal. */
  stage: string;
  /** The two finalists by name. */
  finalists: NamedRef[];
  /** The juror currently asking a question, if any (name only). */
  asking: NamedRef | null;
  /** The votes revealed so far, in reveal order — each a (juror → finalist) pair by name. */
  reveals: Array<{ juror: NamedRef; votedFor: NamedRef }>;
}

/** The Vault-free result of advancing the game or resolving a decision. */
export interface AdvanceView {
  started: boolean;
  /** The beat that just resolved (null if blocked on a decision or the game is over). */
  event: BeatEventView | null;
  /** Set when the loop now needs a player decision before it can continue. */
  pending: PendingDecisionView | null;
  status: PublicGameStatus;
  finished: boolean;
  winner: NamedRef | null;
  /** The in-progress finale projection (0037); present only while the finale is staging. */
  finale?: FinaleView | null;
}

/**
 * A houseguest who, by their own soul motivation, wants to approach the player now
 * (0012/0036). Vault-free: the name and a neutral public pretext only — never the
 * underlying drive (bond vs. threat), which would leak the hidden relationship read.
 */
export interface SocialInitiative {
  houseguest: NamedRef;
  pretext: string;
}

/** A snarky, state-aware one-line hero tagline for the player (0033). Vault-free; one line. */
export interface PlayerTaglineView {
  text: string;
}

/** A player's answer to the current `PendingDecisionView`. */
export interface SubmitDecisionReq {
  kind: "nominations" | "veto-decision" | "replacement" | "eviction-vote" | "final-eviction"
    | "finale-statement" | "finale-answer" | "juror-vote";
  /** nominations: exactly two houseguest ids. */
  choice?: EntityId[];
  /** veto-decision: whether to use the veto. */
  use?: boolean;
  /** veto-decision: the nominee saved when `use` is true. */
  save?: EntityId;
  /** replacement: the replacement nominee the HOH names. */
  replacement?: EntityId;
  /** eviction-vote / juror-vote: the finalist/nominee the player votes for. */
  vote?: EntityId;
  /** finale-statement: the player's free-text opening statement (flavor; carries no score). */
  statement?: string;
  /** finale-answer: the structured appeal the player makes (engine-scored; never the prose). */
  appeal?: string;
}

export interface GameSession {
  /** Run OOBE and start a new game; returns the Vault-free state. */
  createCharacter(req: CreateCharacterReq): GameStateView;
  /** Vault-free public status (week/phase/HOH/nominees/veto) for the status panel. */
  gameStatus(): PublicGameStatus;
  /** The current Vault-free game state (phase, the player's card, the house roster). */
  getGameState(): GameStateView;
  /** The managed system prompt to inject for the current (or requested) moment. */
  getMomentPrompt(req: MomentPromptReq): MomentPromptView;
  /**
   * Resolve a competition over the live house using the engine's OWN stats +
   * seeded temperature. Returns only the winner (name) — no stats/scores cross
   * the wall. The LLM may request this to drive the game; the ENGINE decides.
   */
  runCompetition(req: RunCompetitionReq): CompetitionResultView;
  /**
   * Advance the live weekly loop by ONE beat (0011): HOH comp → nominations →
   * veto comp → veto ceremony → eviction → finale. NPC beats resolve automatically
   * (relationship-driven); when the next beat is the PLAYER's own decision the loop
   * stops and returns it as `pending`. Idempotent while a decision is pending.
   */
  advanceGame(): AdvanceView;
  /** Resolve the current pending decision and continue the loop (validated; 0011). */
  submitDecision(req: SubmitDecisionReq): AdvanceView;
  /**
   * The player makes a deal with a houseguest (0039) — a first-class tracked promise. Recorded as
   * a player-witnessed event (their knowledge); the engine reconciles it against later binding
   * actions and makes a broken promise hurt. Returns the new deal's Vault-free projection.
   */
  makeDeal(req: MakeDealReq): DealView | null;
  /**
   * Which houseguests want to approach the player right now (0012/0036) — relationship-driven
   * (allies scheme, rivals probe), so scenes start from EITHER side, not only player→NPC. Returns
   * names + a neutral pretext; the hidden drive never crosses the wall. Empty before a game starts.
   */
  socialInitiatives(): SocialInitiative[];
  /**
   * A snarky, state-aware Big Brother one-liner for the homepage hero (0033) — reflects the
   * player's CURRENT public standing (HOH / on the block / holding the veto / just a houseguest /
   * pre-game). Vault-free, anti-sycophantic (a weak spot is ribbed, not flattered), one line.
   */
  playerTagline(): PlayerTaglineView;
}
