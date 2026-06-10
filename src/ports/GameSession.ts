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

/**
 * The casting card (0050) — the interview's payoff: the player's character type, strategy, and the
 * producer's QUALITATIVE read of their strengths. Tier WORDS derived from the hidden balanced stats;
 * the numbers themselves never cross the wall (mandate #2/#3). Carries nothing about any NPC.
 */
export interface CastingCard {
  /** The canonical archetype the engine accepted (their own words live on the PlayerCard persona). */
  characterType: string;
  strategyStyle: string;
  /** Per-aptitude tier words (e.g. standout / solid / scrappy) — never numeric values. */
  strengths: { physical: string; mental: string; social: string };
  /** The player's own authored material, played back. */
  story?: string;
  motivation?: string;
}

/** The player's own authored card. They authored it, so persona is theirs — but NO numeric stats cross the wall. */
export interface PlayerCard {
  id: EntityId;
  name: string;
  archetype: string;
  strategyStyle: string;
  /**
   * Where the player stands in the game (0046): `active` (still playing), `jury` (evicted into the
   * last-9 jury — they spectate the public ceremonies and vote at the finale), or `evicted` (voted out
   * pre-jury — their season is over). Public, Vault-free: it says nothing about anyone's hidden state.
   */
  status: "active" | "jury" | "evicted";
  /** The casting interview's distilled card (0050) — qualitative only; re-showable all season. */
  castingCard?: CastingCard;
}

/**
 * A public houseguest card (B61): name + status + the CURATED PUBLIC persona facets — the
 * things any houseguest can see across the kitchen counter (and the narrator needs to give
 * each person a consistent voice). NEVER stats, the soul, relationship values, or hidden
 * elements; those stay engine-side (the live sentinel sweep guards this projection).
 */
export interface HouseguestCard {
  id: EntityId;
  name: string;
  /** active | jury (evicted into the last-9) | evicted (pre-jury). Public ceremony fact. */
  status: string;
  archetype?: string;
  strategyStyle?: string;
  background?: string;
  age?: number;
  appearance?: string;
  presentation?: string;
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
  /** Pre-game only (0050): where the casting interview stands — what's captured, what's next. */
  casting?: CastingStatusView;
}

/**
 * The casting interview's incremental intake (0050). OOBE is no longer one atomic call: the
 * producer records each answer AS IT LANDS, the engine tracks which building blocks are in,
 * and that status determines the interview's next step. All fields are the player's own
 * authored material; the intake lives pre-game and is durable (a half-done interview survives
 * a restart, 0030). `createCharacter` finalizes from it.
 */
export interface UpdateCastingReq {
  /** The player's display name — the one REQUIRED field before casting can finalize. */
  playerName?: string;
  /** The producer's canonical casting-sheet mapping (drives balanced hidden stats). */
  archetype?: string;
  strategyStyle?: string;
  /** The player's OWN words for who they are / how they'll play (display & narrative only). */
  personaArchetype?: string;
  personaStrategyStyle?: string;
  /** Their life outside the house, in their words. */
  backstory?: string;
  /** Why they came to play — player-only material. */
  motivation?: string;
  /** How they ACTUALLY plan to play — player-only (NO_NPC_PATHWAY, 0013/0015). */
  privateStrategy?: string;
  /** Get-to-know notes — APPENDED to what's already recorded (never replaced). */
  interviewNotes?: string[];
}

/** Where the casting interview stands (0050) — Vault-free; it echoes only the player's own words. */
export interface CastingStatusView {
  /** Fields already captured, echoing the recorded value (notes echo as a count). */
  known: Record<string, string>;
  /** Coverage still to acquire, in the engine's interview order. */
  missing: string[];
  /** The engine-picked next step of the interview (null when coverage is complete). */
  next: string | null;
  /** True once the required minimum (a name) is in — createCharacter may finalize. */
  ready: boolean;
}

/** The player makes a deal WITH a houseguest (player↔NPC). NPC↔NPC deals are off-screen/Vault-held. */
export interface MakeDealReq {
  with: EntityId;
  kind: "safety" | "vote" | "final-two" | "target-other";
  terms: string;
}

export interface CreateCharacterReq {
  /**
   * The player's authored display name (the only human-authored profile). Optional since 0050:
   * when omitted, finalization uses the name the casting interview recorded via `updateCasting`
   * (a name from SOMEWHERE is still required — creation is rejected without one).
   */
  playerName?: string;
  archetype?: string;
  strategyStyle?: string;
  // --- Casting-interview deepeners (0050): the producer's distillation of the interview. ---
  /** The player's OWN words for who they are / how they'll play (display & narrative only). */
  personaArchetype?: string;
  personaStrategyStyle?: string;
  /** Their life outside the house, in their words → the static Character's background. */
  backstory?: string;
  /** Why they came to play — player-only material; seeds the Soul memory. */
  motivation?: string;
  /** How they ACTUALLY plan to play — player-only (NO_NPC_PATHWAY, 0013/0015). */
  privateStrategy?: string;
  /** Distilled get-to-know answers — seed the Soul memory as the player's pre-game memories. */
  interviewNotes?: string[];
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
  kind: "nominations" | "veto-decision" | "comp-intent" | "houseguests-choice" | "replacement" | "eviction-vote" | "tie-break" | "final-eviction"
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

/**
 * The Vault-free projection of an in-progress weekly eviction (0047). The two nominees by name, the
 * current stage, and the votes REVEALED SO FAR only — NEVER the unread votes, never a pre-reveal tally,
 * never the evictee before the last vote lands. A vote appears here only once read in the seeded order.
 */
export interface EvictionView {
  /** Which stage the eviction is in: votes | goodbye | result. */
  stage: string;
  /** The two nominees by name. */
  nominees: NamedRef[];
  /** The votes revealed so far, in reveal order — each a (voter → the nominee they voted to evict) by name. */
  votesRevealed: Array<{ voter: NamedRef; votedFor: NamedRef }>;
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
  /** The in-progress eviction projection (0047); present only while a weekly eviction is staging. */
  eviction?: EvictionView | null;
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

/**
 * Where the player stands in the house RIGHT NOW (0049) — the Vault-free presence read. Who is in
 * the player's room and who is one room over: facts a houseguest could see or hear themselves.
 * NEVER motives, numbers, hidden state, or the occupancy of non-adjacent rooms (you can't see
 * through walls — fog of war is gameplay).
 */
export interface WhereaboutsView {
  /** The room the player is in. */
  room: string;
  /** Who else is in the player's room (names only). */
  present: NamedRef[];
  /** Each ADJACENT room and who is in it (names only). Non-adjacent rooms never appear. */
  nearby: Array<{ room: string; present: NamedRef[] }>;
}

/**
 * The season's PUBLIC arc, assembled from the event record (0048 — principle #7: stores, not
 * narrator memory). Vault-free at any time: it is exactly what the player lived through.
 */
export interface SeasonRecapView {
  started: boolean;
  finished: boolean;
  winner: NamedRef | null;
  weeksPlayed: number;
  /** Chronological public highlights straight from the recorded ceremony/deal events. */
  highlights: string[];
  /** The eviction order so far (names, in order). */
  evicted: NamedRef[];
  /** Deals the player was party to, with their final status. */
  deals: DealView[];
}

/**
 * The unsealed hidden story (0048) — the Wall's ONE sanctioned, structurally-gated exception.
 * Returned ONLY for a finished season (the gate lives in code, on the terminal state): the
 * off-screen scheming, the confessionals, and the producer's sealed twists. While a season is
 * live this is unreachable — there is a game to spoil; afterwards it is the payoff.
 */
export interface RetrospectiveView {
  winner: NamedRef | null;
  /** The hidden story in recorded order: off-screen scenes + confessionals (names humanized). */
  hiddenStory: Array<{ type: string; content: string }>;
  /** The producer's sealed reserve twists: each kind + the week it fired (null = never fired). */
  twists: Array<{ kind: string; firedWeek: number | null }>;
}

/** A player's answer to the current `PendingDecisionView`. */
export interface SubmitDecisionReq {
  kind: "nominations" | "veto-decision" | "comp-intent" | "houseguests-choice" | "replacement" | "eviction-vote" | "tie-break" | "final-eviction"
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
  /** comp-intent: the player's declared approach — "compete" | "throw" | "play-safe" (B46). */
  intent?: string;
}

export interface GameSession {
  /** Run OOBE and start a new game; returns the Vault-free state. */
  createCharacter(req: CreateCharacterReq): GameStateView;
  /**
   * Record casting-interview answers as they land (0050) — any subset of fields, callable any
   * number of times pre-game. Returns where the interview stands (known / missing / next / ready);
   * the engine, not the model, decides the next step. No-op (current status) once a game started.
   */
  updateCasting(req: UpdateCastingReq): CastingStatusView;
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

  /**
   * The Vault-free projection of an in-progress finale (0037 §8.1) for a polling finale panel — the
   * SAME projection already proven on `AdvanceView.finale`: names + the current stage + the reveals SO
   * FAR only. `null` unless a finale is actively staging. No lean, tally, manner, or pre-reveal winner.
   * Infra (like `gameStatus`/`playerTagline`), not a game-driving lever.
   */
  finaleView(): FinaleView | null;

  /**
   * The Vault-free presence read (0049): the player's room, who is in it, and who is in each
   * ADJACENT room. Grounds lingering play — "who's here? who's nearby?" has an engine answer the
   * narrator queries instead of inventing. `null` before a game starts (or once the player is out).
   */
  whereabouts(): WhereaboutsView | null;

  /** The season's public arc from the event record (0048) — Vault-free, reproducible, any time. */
  seasonRecap(): SeasonRecapView;

  /**
   * The Vault unsealing (0048 §1): the hidden story of THIS user's FINISHED season. Returns `null`
   * for a live (or not-started) season — the gate is the terminal state, enforced in code, never
   * by prompt. The one sanctioned Vault-reading seam, post-season only, player-triggered.
   */
  seasonRetrospective(): RetrospectiveView | null;
}
