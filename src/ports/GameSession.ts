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

/** The Vault-free projection of the running game the front-end may render. */
export interface GameStateView {
  started: boolean;
  week: number;
  phase: string;
  /** The current beat key (drives which managed prompt fragment is injected). */
  moment: string;
  player: PlayerCard | null;
  house: HouseguestCard[];
}

export interface CreateCharacterReq {
  /** The player's authored display name (the only human-authored profile). */
  playerName: string;
  archetype?: string;
  strategyStyle?: string;
  /** Optional seed for a reproducible house; the front-end may send a random one for variety. */
  seed?: number;
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

/** A decision the live loop is blocked on until the player resolves it (0011). */
export interface PendingDecisionView {
  kind: "nominations" | "veto-decision" | "replacement" | "eviction-vote";
  by: NamedRef;
  /** A human-readable instruction for the moment (what the player must choose). */
  prompt: string;
  /** The legal choices (the houseguests the player may pick among). */
  options: NamedRef[];
  /** How many to pick (nominations = 2; others = 1). */
  pick: number;
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
}

/** A player's answer to the current `PendingDecisionView`. */
export interface SubmitDecisionReq {
  kind: "nominations" | "veto-decision" | "replacement" | "eviction-vote";
  /** nominations: exactly two houseguest ids. */
  choice?: EntityId[];
  /** veto-decision: whether to use the veto. */
  use?: boolean;
  /** veto-decision: the nominee saved when `use` is true. */
  save?: EntityId;
  /** replacement: the replacement nominee the HOH names. */
  replacement?: EntityId;
  /** eviction-vote: the final nominee the player votes to evict. */
  vote?: EntityId;
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
}
