import type { EntityId } from "../domain/ids";
import type { PhysicalCharacteristics } from "../domain/physicalCharacteristics";

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
  /**
   * True when the engine DEFAULTED the character type (C6): the interview never captured a
   * recognizable archetype, so the median spec was used — surfaced so an early finalization
   * is visible on the card rather than a silent stat assignment.
   */
  defaulted?: boolean;
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
  /**
   * The concrete, diverse backstory facets (L28): the houseguest's vocation and hometown — public,
   * Vault-free origin facts the narrator voices instead of inventing (and mirroring the player).
   */
  vocation?: string;
  hometown?: string;
  /**
   * The observable public DEMEANOR / voice register (L28) — how this houseguest comes across in the
   * room (blunt, deadpan, anxious, grandiose…). Public, Vault-free: the narrator voices THIS stored
   * register so each person sounds distinct, instead of defaulting everyone to warm-and-witty.
   */
  demeanor?: string;
  /**
   * The PUBLIC deep-profile facets (feature 0058): a multi-sentence `biography` (the presentable
   * backstory) and the STRUCTURED `physicalCharacteristics` facet (the single source of truth the
   * narration AND the portrait prompt both read, L29/L23). Public, Vault-free, byte-stable. The
   * HIDDEN half (secrets, true goals, weakness, Day-1 perception) NEVER appears on this card.
   */
  biography?: string;
  physicalCharacteristics?: PhysicalCharacteristics;
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

/** A portrait prompt for one houseguest (0051) — returned at season start for the FE to call the image API. */
export interface PortraitPromptEntry {
  houseguestId: string;
  name: string;
  prompt: string;
}

/** The Vault-free projection of the running game the front-end may render. */
export interface GameStateView {
  started: boolean;
  week: number;
  phase: string;
  /**
   * The season is OVER — a winner is crowned (audit B6-01). Vault-free (whether the game ended is
   * public). Lets the FE gate the season lifecycle (0057 next-season) and fill the progress bar to
   * 100% without inferring it from `moment`/`phase`. `finished` lives on `AdvanceView`/`SeasonRecap`
   * too; surfacing it here keeps every read consistent.
   */
  finished: boolean;
  /** The current beat key (drives which managed prompt fragment is injected). */
  moment: string;
  /**
   * This week's ceremony state — the HOH, the nominees, and the veto. All PUBLIC ceremony facts the
   * whole house knows (Vault-free; mirrors `PublicGameStatus`). Surfaced into the model's persistent
   * GAME CONTEXT (audit C8-04) so the narrator voices the REAL HOH / nominations / veto holder
   * instead of inventing them when it narrates a ceremony without separately fetching the status.
   * Empty/null pre-game and between ceremonies.
   */
  ceremony: {
    hoh: { id: EntityId; name: string } | null;
    nominees: Array<{ id: EntityId; name: string }>;
    /**
     * The veto: who holds it + whether it was used, AND the SIX drawn to play the veto comp
     * (`players` — the witnessed chip draw, E35/C-03; empty before the draw). Surfaced so the
     * narrator voices who actually competes (and never tells the player they're benched when the
     * engine drew them IN — audit R9-AGENCY-1) instead of inventing the field.
     */
    veto: { holder: { id: EntityId; name: string } | null; used: boolean; players: Array<{ id: EntityId; name: string }> };
  };
  /**
   * WHERE THE PLAYER IS — their room, who is with them, and each ADJACENT room with its occupants
   * (the player's own scoped view, Vault-free: only what they could see or hear themselves; non-
   * adjacent rooms never appear). Surfaced into the model's persistent GAME CONTEXT (L21/L24) so the
   * narrator voices the REAL occupancy instead of inventing positions or "still to arrive" houseguests
   * (the engine seats everyone at premiere — there are no arrivals). Null pre-game / when the player
   * is out of the house. Also feeds the "Where you are" gadget (L26).
   */
  whereabouts?: WhereaboutsView | null;
  player: PlayerCard | null;
  house: HouseguestCard[];
  /** Deals the player is party to (0039) — fact + status only, never the hidden opinion numbers. */
  deals?: DealView[];
  /**
   * The PUBLIC showmances (0059/L40) — the houseguest pairs whose romance has become VISIBLE to the
   * whole house (stage `visible`). A public fact at that point (not a Vault leak), surfaced so the
   * narrator may voice romance for THESE pairs only — never for ordinary high-affinity friendships.
   * Pre-visible (sealed) showmances and the pre-game ties NEVER appear here. Absent when there are none.
   */
  showmances?: Array<{ a: string; b: string }>;
  /** Pre-game only (0050): where the casting interview stands — what's captured, what's next. */
  casting?: CastingStatusView;
  /** Portrait prompts returned at season start (0051) — present only on the createCharacter response. The FE calls the image API with these and stores the results. */
  portraitPrompts?: PortraitPromptEntry[];
  /**
   * A `createCharacter` that was REFUSED rather than honored (audit R4-05): a game already exists
   * and no `confirmRestart` was given, so the prior season is intact and untouched (this view IS
   * that prior season, not a new one). `in-progress` (a season is live) or `over` (a winner is
   * crowned). The producer must NOT narrate a new season — direct the player to the menu / a
   * confirmed restart. Absent on a real (fresh or confirmed) creation.
   */
  createRefused?: "in-progress" | "over";
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
  /**
   * Scalar fields this update OVERWROTE — an already-captured value replaced by a different one
   * (audit C8's third sub-item). Present only on the `updateCasting` that caused it, so the
   * producer can CONFIRM the replacement ("changing their backstory — got it") rather than
   * silently clobbering an answer. Empty/absent when nothing captured was changed.
   */
  overwrote?: string[];
  /**
   * Keys the caller passed that are NOT casting fields (audit R4-01) — e.g. `name` (the field is
   * `playerName`), `notes`, or a typo. Echoed so a recording is never silently dropped: the
   * producer learns the answer didn't land and can re-file it under the right field. Absent when
   * every key was understood.
   */
  ignoredKeys?: string[];
  /**
   * Casting is CLOSED — there is already a game (audit R4-05). An honest refusal instead of a
   * fake "ready": `in-progress` (a season is live) or `over` (a winner is crowned). The producer
   * must NOT keep interviewing or claim a season started; a new season begins only through the
   * sanctioned restart door (the menu / a confirmed `createCharacter`). Absent pre-game.
   */
  refused?: "in-progress" | "over";
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
  /**
   * Season-to-season continuity (0056): on a CONFIRMED restart, KEEP the prior player's character —
   * carry their authored fields (name/archetype/strategy/persona/backstory/motivation/private
   * strategy/interview notes) into the new season so the SAME static CHARACTER returns to a NEW cast
   * (a fresh seed). Explicit fields here still override field-by-field (a player may tweak on the way
   * through). The dynamic SOUL/relationships reset at move-in. Ignored without `confirmRestart`, and
   * a no-op on a fresh (no prior game) creation. Absent/false ⇒ a normal fresh creation (re-run casting).
   */
  keepCharacter?: boolean;
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
  /** The drawn competition's name (0042) — set while a comp beat is live. */
  name?: string;
  /** The drawn competition's narrative format (endurance / puzzle / quiz / skill / crapshoot / social). */
  format?: string;
  /** The Vault-free narrative scaffold (0042/0018): premise + beats + how a win reads — flavor only, never a stat or score. */
  narrative?: { premise: string; beats: string[]; winReads: string };
}

/** Vault-free public status for the status panel (0020): ceremony-level facts only. */
export interface PublicGameStatus {
  week: number;
  phase: string;
  /**
   * The in-game DAY within the current HOH week (E58): hoh=1, nominations=2, veto=3,
   * veto-ceremony=4, eviction=5 — the canonical `dayOfWeek(phase)` mapping that already feeds the
   * GM moment prompt, now surfaced so the player UI can show "Day N". `null` off the weekly ladder
   * (pre-game, finale, twist beats). Ceremony-level fact only — no hidden state.
   */
  day: number | null;
  hoh: { id: EntityId; name: string } | null;
  nominees: Array<{ id: EntityId; name: string }>;
  veto: {
    holder: { id: EntityId; name: string } | null;
    used: boolean;
    /**
     * The drawn six (E35): WHO plays the Power of Veto this week — the witnessed chip draw is a
     * public ceremony of its own (HOH + the two nominees + three by chip, incl. any Houseguest's-
     * Choice pick). Empty before the draw has run and after the week rolls. Vault-free: the field
     * is public the moment the chips are pulled, so the narrator names THESE exact players instead
     * of inventing who competes (parallels the nominee grounding, audit C-03).
     */
    players: Array<{ id: EntityId; name: string }>;
  };
  /**
   * The CURRENT binding decision the loop is blocked on (the same Vault-free legal-options view the
   * advance returns), or null when the engine isn't waiting on the player. Surfaced here so the
   * decision card can re-arm from ENGINE TRUTH after a reload — robust to a front-end restart or an
   * out-of-band advance (the FE's last-seen cache is process-local and goes stale; this never does).
   */
  pending: PendingDecisionView | null;
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
    | "goodbye-message" | "finale-statement" | "finale-answer" | "juror-question" | "juror-vote";
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
  /** The finalist being questioned, for a `juror-question` (E37); absent otherwise. */
  finalist?: NamedRef;
  /** The evictee receiving the player's goodbye, for a `goodbye-message` (E34); absent otherwise. */
  evictee?: NamedRef;
  /** How many to pick (nominations = 2; others = 1; finale-statement / juror-question = 0). */
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
 * E12: eviction votes are SECRET BALLOTS — the reveal carries the ballot ("a vote to evict X"), never
 * the voter; attributions unseal only in the post-season retrospective (0048).
 */
export interface EvictionView {
  /** Which stage the eviction is in: votes | goodbye | result. */
  stage: string;
  /** The two nominees by name. */
  nominees: NamedRef[];
  /** The anonymized ballots revealed so far, in reveal order — the nominee each vote names, never the voter. */
  votesRevealed: Array<{ votedFor: NamedRef }>;
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
 * (0012/0036, reshaped by audit E60 per ADR 0003): the name plus a COARSE categorical
 * motive — `bond` (their tie to the player drives the approach) or `probe` (their threat
 * read does). The motive is the fact the narrator voices in its own words; the underlying
 * trust/affinity/threat numbers never cross the wall, and the engine ships no canned
 * pretext line ("facts to voice, never scripts to recite").
 */
export interface SocialInitiative {
  houseguest: NamedRef;
  motive: "bond" | "probe";
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
  /**
   * DURATION — how many consecutive player-turns the player has been in this room (0 = just
   * arrived this turn). Grounds scene continuity so the narrator voices persistence ("you've held
   * the kitchen a while") instead of resetting the scene each turn (L21/L24). `companions` carries
   * the same tenure for each houseguest currently with the player, so the model knows who has been
   * lingering with them vs. who just walked in.
   */
  turnsHere: number;
  companions: Array<{ id: EntityId; name: string; turnsHere: number }>;
}

/**
 * The per-NPC voicing projection (B65 / ADR 0003 §8 — "people must make sense", structurally).
 * Everything the narrator may draw on to voice ONE houseguest: their stable public persona, where
 * they are and who is with them, what THEY legitimately know (witnessed / told / overheard), their
 * hunches, and their organic stances (labels through their own disposition — NEVER numbers).
 *
 * The sanctioned, PER-NPC-BOUNDED voicing seam: the model is handed a knowledge-bounded houseguest
 * and structurally cannot voice what that houseguest never learned. What it contains of the hidden
 * layer is exactly what THIS houseguest knows — which they may, in character, choose to reveal
 * (that is the game); other houseguests' private knowledge, the Vault, souls, and every number
 * stay out by construction.
 */
export interface NpcVoiceView {
  houseguest: NamedRef;
  /** The stable public persona facets (B61) — byte-stable across the whole season. */
  persona: {
    archetype?: string; strategyStyle?: string; background?: string;
    age?: number; appearance?: string; presentation?: string;
    /** The observable voice register (L28) — voice this houseguest in THEIR demeanor, not a default. */
    demeanor?: string;
    /**
     * The PUBLIC deep-profile facets (0058) — voice the houseguest's STORED biography + physical
     * characteristics, never invent (and drift) them. Both are Vault-free public facets; the HIDDEN
     * profile (secrets/goals/weakness/perception) is NEVER on this projection.
     */
    biography?: string; physicalCharacteristics?: PhysicalCharacteristics;
  };
  /** Where they are + who is in the room with them (0049). Null when presence is unseeded. */
  whereabouts: { room: string; present: NamedRef[] } | null;
  /** What THIS houseguest legitimately knows — content only, most recent first-capped. */
  knows: string[];
  /** Their hunches (no pathway): they may voice suspicion, never certainty (0002). */
  suspects: string[];
  /** Organic stances toward the other ACTIVE houseguests — labels, never numbers (ADR 0002). */
  stances: Array<{ toward: NamedRef; stance: string }>;
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
  /**
   * The UNSEALED weekly eviction ballots (E12): who really voted to evict whom, week by week.
   * Secret all season (the live reveal is anonymized); tellable only here, post-season.
   */
  evictionVotes?: Array<{
    week: number;
    evictee: NamedRef;
    votes: Array<{ voter: NamedRef; votedFor: NamedRef }>;
  }>;
}

/**
 * The Vault-free result of an ADMIN fast-forward to the finale (L38). The dev-only "finish my
 * season so the post-season retrospective unseals" lever DRIVES the deterministic engine — it
 * reads NO Vault and reveals nothing hidden: it carries only PUBLIC ceremony facts (the crowned
 * winner's NAME, weeks played, the player's final placement). The retrospective (0048) still
 * unseals through its OWN code-gated post-finale path — this only makes the season FINISH.
 */
export interface FinaleFastForwardView {
  /** True once the season is over — a winner is crowned (or it was already finished). */
  finished: boolean;
  /** The crowned winner's NAME (Vault-free public fact), or null if the season did not finish. */
  winnerName: string | null;
  /** Weeks played to the crown (the public week count). */
  weeks: number;
  /** Where the PLAYER finished — `winner`, `runner-up`, `jury`, or `evicted` (public seat facts). */
  playerPlacement: "winner" | "runner-up" | "jury" | "evicted" | "unknown";
  /** No game was started, so there was nothing to fast-forward (Vault-free; never raises). */
  started: boolean;
}

/** A player's answer to the current `PendingDecisionView`. */
export interface SubmitDecisionReq {
  kind: "nominations" | "veto-decision" | "comp-intent" | "houseguests-choice" | "replacement" | "eviction-vote" | "tie-break" | "final-eviction"
    | "goodbye-message" | "finale-statement" | "finale-answer" | "juror-question" | "juror-vote";
  /** nominations: exactly two houseguest ids. For houseguests-choice / tie-break / final-eviction
   *  a single pick may ride here as a 1-element array (the FE tool schema's convention) — the
   *  engine accepts it interchangeably with `vote` (audit A10). */
  choice?: EntityId[];
  /** veto-decision: whether to use the veto. */
  use?: boolean;
  /** veto-decision: the nominee saved when `use` is true. */
  save?: EntityId;
  /** replacement: the replacement nominee the HOH names. */
  replacement?: EntityId;
  /** eviction-vote / juror-vote: the finalist/nominee the player votes for.
   *  goodbye-message: the chosen tone ("warm" | "respectful" | "cold") rides here (E34). */
  vote?: EntityId;
  /** finale-statement / juror-question: the player's free text (flavor; carries no score).
   *  goodbye-message: the optional message text accompanying the chosen tone. */
  statement?: string;
  /** finale-answer: the structured appeal the player makes (engine-scored; never the prose). */
  appeal?: string;
  /** comp-intent: the player's declared approach — "compete" | "throw" | "play-safe" (B46). */
  intent?: string;
}

/**
 * The write-back seam (feature 0058 / ledger L28b) — the FE producer-LLM authors a houseguest's rich
 * §3 profile (endless variety) and writes it BACK here so the ENGINE becomes the source of truth
 * (mirrors the 0051 portrait-prompt handshake). The engine validates / repairs (diversity + non-
 * player-mirroring), SPLITS it across the Vault Wall (public facets onto the byte-stable Character;
 * secrets/goals/weakness/perception sealed into the Vault), INDEXES it for full-fidelity recall
 * (L27b), and SEEDS the story threads + the NPC→player edge from it.
 *
 * PHASE 1: this is the clearly-TYPED seam, STUBBED (it records nothing structurally yet) and unit-
 * tested. The deterministic seeded floor is the live profile source for now; wiring the live LLM
 * write-back (validate/repair/split/seal/index) is Phase 2. Everything PUBLIC here may cross to the
 * player; everything HIDDEN is sealed and never projected.
 */
export interface RecordCastProfileReq {
  /** Which houseguest this authored profile is for. */
  houseguestId: EntityId;
  // --- PUBLIC (crosses to the player; folded onto the byte-stable Character) ---
  /** A real multi-sentence backstory (the presentable parts). */
  biography?: string;
  /** The structured physical-characteristics facet (text↔image single source of truth). */
  physicalCharacteristics?: PhysicalCharacteristics;
  // --- HIDDEN (Vault-sealed; NEVER projected to player or admin) ---
  /** 2–3 secrets. */
  secrets?: string[];
  /** The true strategic goals. */
  trueGoals?: string[];
  /** The named weakness / blind spot. */
  weakness?: string;
  /** The Day-1 perception-of-the-player read (seeds the NPC→player edge). */
  dayOnePerception?: string;
}

/** Whether the write-back was accepted (and which fields, Vault-free — never echoes a secret). */
export interface RecordCastProfileResult {
  /** True iff the houseguest exists and a profile could be recorded. */
  accepted: boolean;
  /** The PUBLIC field NAMES that were accepted (never their hidden values). */
  publicFields: string[];
  /** The HIDDEN field NAMES that were accepted (names only — the values are sealed, never echoed). */
  hiddenFields: string[];
  /** Set when not accepted (unknown houseguest / no game / phase-2-deferred path). */
  reason?: string;
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
   * names + a coarse motive (bond | probe); the hidden numbers never cross the wall. Empty before
   * a game starts.
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

  /**
   * The player walks to a room (L21/L24) — the player is a person, so THEY direct their movement;
   * the engine never auto-relocates them, only holds them where they chose (NPCs drive around them).
   * Sets the player's room + resets their tenure and returns the resulting whereabouts. No-op for an
   * unknown room / before a game starts (returns the current whereabouts unchanged). Vault-free.
   */
  movePlayer(room: string): WhereaboutsView | null;

  /** The season's public arc from the event record (0048) — Vault-free, reproducible, any time. */
  seasonRecap(): SeasonRecapView;

  /**
   * The Vault unsealing (0048 §1): the hidden story of THIS user's FINISHED season. Returns `null`
   * for a live (or not-started) season — the gate is the terminal state, enforced in code, never
   * by prompt. The one sanctioned Vault-reading seam, post-season only, player-triggered.
   */
  seasonRetrospective(): RetrospectiveView | null;

  /**
   * The knowledge-bounded voicing projection for ONE active houseguest (B65 / ADR 0003 §8) —
   * everything the narrator may draw on to voice them, nothing they never learned. Null for an
   * unknown or non-active houseguest (the departed are voiced from the public record only).
   */
  npcVoice(id: EntityId): NpcVoiceView | null;

  /** Return the portrait prompt for a specific houseguest by id (0051) — Vault-free; uses public appearance facets. Null if no game is started or the houseguest is unknown. */
  getPortraitPrompt(id: EntityId): { houseguestId: string; name: string; prompt: string } | null;

  /**
   * The deep-profile write-back seam (feature 0058 / L28b) — the FE-authored §3 profile is recorded
   * here so the ENGINE is the source of truth: PUBLIC facets fold onto the byte-stable Character;
   * HIDDEN facets are sealed into the Vault and NEVER projected. PHASE 1: clearly typed + STUBBED
   * (it validates the target and reports which fields it would accept, without yet overwriting the
   * seeded floor); the live validate/repair/split/seal/index wiring is Phase 2. The result never
   * echoes a hidden value (it reports field NAMES only).
   */
  recordCastProfile(req: RecordCastProfileReq): RecordCastProfileResult;
}
