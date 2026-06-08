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
}
