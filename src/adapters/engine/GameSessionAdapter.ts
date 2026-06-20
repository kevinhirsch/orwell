import type {
  GameSession, CreateCharacterReq, GameStateView, MomentPromptReq, MomentPromptView,
  RunCompetitionReq, CompetitionResultView, PublicGameStatus,
  AdvanceView, SubmitDecisionReq, PendingDecisionView, NamedRef, SocialInitiative, PlayerTaglineView,
  FinaleView, EvictionView, MakeDealReq, DealView, WhereaboutsView,
  SeasonRecapView, RetrospectiveView, NpcVoiceView,
  UpdateCastingReq, CastingStatusView, PortraitPromptEntry,
  RecordCastProfileReq, RecordCastProfileResult, FinaleFastForwardView,
  WorldSnapshotView, RecordWorldSnapshotReq, RecordWorldSnapshotResult,
  PremiereIntrosView, FirstImpressionView,
} from "../../ports/GameSession";
import { randomBytes } from "node:crypto";
import { humanizeIds, humanizeForRetrospective } from "./humanize";
import { singlePickId } from "./decisionFields";
import type { GameEvent } from "../../domain/event";
import { assignRooms } from "../../engine/presence";
import { dayOfWeek } from "../../engine/houseEvents";
import { HOUSE_ADJACENCY, resolveRoom } from "../../domain/house";
import type { Room, Occupancy } from "../../domain/house";
import type { RandomnessSource } from "../../ports/RandomnessSource";
import type { CastingIntake } from "../../engine/castingIntake";
import { castingStatusOf, emptyIntake, ignoredCastingKeys, intakeIsEmpty, mergeCastingUpdate, overwrittenScalars } from "../../engine/castingIntake";
import { DealLedger } from "../../engine/deals";
import type { BindingAction, Deal } from "../../engine/deals";
import { involvedConfessionals, recordConfessionalToSoul } from "../../engine/confessionals";
import type { ConfessionalContext } from "../../engine/confessionals";
import { rankApproaches } from "../../engine/conversation";
import { DECISION } from "../../engine/decisionConstants";
import type { EvictionManner } from "../../engine/jury";
import type { NarrativePort } from "../../ports/NarrativePort";

/** Player public standing — the only axis the snarky hero tagline (0033) keys on. Vault-free. */
type Standing = "pre-game" | "hoh" | "nominee" | "veto-holder" | "houseguest";

/**
 * Curated, state-aware snarky Big Brother taglines (0033). Anti-sycophantic: a weak standing is
 * ribbed, not flattered. These are also the FAIL-OPEN fallback when no real narrator is wired (the
 * live narrator is a stub today) — so the hero line is always good, never a JSON dump, never blank.
 */
const SNARKY_TAGLINES: Record<Standing, string> = {
  "pre-game": "Sixteen strangers, one house, zero privacy — ready to lie to everyone you haven't met yet?",
  hoh: "Head of Household: for one week the whole house adores you and means none of it.",
  nominee: "On the block and on camera. Smile — someone you trusted put you here.",
  "veto-holder": "You're holding the veto, so suddenly everybody remembers your name.",
  houseguest: "Another day in the house. Trust no one — especially the ones being nice.",
};

const TAGLINE_INSTRUCTION =
  "Write ONE biting Big Brother welcome line for the player at this moment. One sentence, no spoilers, no quotes.";

/** First line, trimmed, length-capped — a hero line is one short line. */
function oneLine(s: string): string {
  return (s.split("\n")[0] ?? "").trim().slice(0, 120);
}
/** Reject empty/over-long output and the Echo stub's context dump (so we fall open to the template). */
function isUsableTagline(s: string): boolean {
  return s.length > 0 && s.length <= 120 && !/[{}]/.test(s) && !/forEntity|visibleEvents|systemPrompt/i.test(s);
}
import { buildPortraitPrompt, buildCastPortraitPrompts, physicalFacetToAppearance } from "../../engine/portraitPrompts";
import { STYLE_ANCHOR_VARIANTS } from "../../engine/imageConstants";
import { startNewGame, hashSeed, isPlausibleArchetype, strengthTier, dispositionOf, archetypeMenace } from "../../engine/characterFactory";
import type { GameHouse, StrategyStyle, Soul } from "../../engine/characterFactory";
import { evolveEmotion, arcNote, offscreenEmotion } from "../../engine/emotionalArc";
import type { EmotionalEvent } from "../../engine/emotionalArc";
import type { SoulProvider } from "../../ports/SoulProvider";
import type { InteractionType } from "../../engine/relationships";
import {
  CEREMONY_IMPACTS, EVICTION_MANNER_SCALE, RELATIONSHIP_CONSTANTS, clamp01, scaleImpact,
} from "../../engine/relationshipConstants";
import type { CeremonyAct } from "../../engine/relationshipConstants";
import { buildSystemPrompt, momentForPhase, renderStoryFacts } from "../../engine/momentPrompts";
import { producerForSeed, renderProducerVoice, type Producer } from "../../engine/producerPersona";
import { buildWorldSnapshot, renderZeitgeist, hasZeitgeist, ZEITGEIST, type WorldSnapshot, type ZeitgeistSlice } from "../../engine/zeitgeist";
import type { CompetitionType, Intent } from "../../domain/competitionOutcome";
import { SeededRandom } from "../random/SeededRandom";
import { PLAYER } from "../../domain/ids";
import type { EntityId } from "../../domain/ids";
import { EngineRefusal } from "../../domain/errors";
import { RelationshipModel, relationshipLabel } from "../../engine/relationships";
import type { Stats } from "../../engine/season";
import {
  newLiveSeason, advance as advanceBeat, applyDecision, autoDecision, recordDealBetrayal, peekCompetition, COMP_INTENTS, GOODBYE_TONES,
  firstCeremonyBeatResolved,
  requestSelfEviction as requestSelfEvict, cancelSelfEviction as cancelSelfEvict, applySelfEviction, playerHasLeft,
  type LiveSeasonState, type SeasonCtx, type BeatEvent, type DecisionInput, type PendingDecision, type GoodbyeTone,
  type FinaleProgress, type EvictionProgress,
} from "../../engine/liveSeason";
import { APPROACH_GATE } from "../../engine/decisionConstants";
import { FINALE_APPEALS, type FinaleAppeal } from "../../engine/jury";
import { loadReserveTwists } from "../../engine/reserveTwists";
import {
  generateCastDeepLayer, deepProfileToVaultContent, generateDeepProfile, deriveStoryThreads,
  defaultTriggerConditionFor, triggerMet, sourceWindowClosed, threadRumor,
  storyThreadToRetrospectiveProse,
  type SeasonPosition,
} from "../../engine/deepProfile";
import { THREAD } from "../../engine/threadConstants";
import {
  loadSeededRelationships, TIE_AFFINITY_BIAS, SHOWMANCE_SPARK_BIAS,
  DEFAULT_TIE_BUDGET, DEFAULT_SHOWMANCE_BUDGET, nextShowmanceStage,
  preGameTieToRetrospectiveProse, showmanceToRetrospectiveProse,
} from "../../engine/seededRelationships";
import type { SeededRelationships } from "../../engine/seededRelationships";
import type { DeepProfile, StoryThread } from "../../engine/deepProfile";
import {
  generateDiversityLayer, privateOrientationToVaultContent, showmancePlausible,
} from "../../engine/diversity";
import type { Orientation, GenderPresentation } from "../../engine/diversityConstants";
import { foldHiddenImpact } from "../../engine/consequence";
import { derivedLoyalty } from "../../engine/blocs";
import type { ReserveTwist, TwistKind } from "../../engine/reserveTwists";
import type { CeremonyState, SessionCore } from "../../engine/sessionSnapshot";
import { cloneSession, fastClone } from "../../engine/sessionSnapshot";

const COMP_TYPES: ReadonlySet<string> = new Set<CompetitionType>([
  "endurance", "physical", "puzzle", "quiz", "memory", "mental", "social",
]);

/**
 * A READABLE category label for a hidden record's machine kind/type, for the post-season retrospective
 * (0048). The FE renders each unsealed row as "[type] content", so a raw slug (`hidden-thread`,
 * `seeded-relationship`, `offscreen-event`) becomes a debug tag; this maps it to plain words instead.
 * Pure / Vault-free (a category name reveals nothing). Unknown kinds fall back to a de-slugged title.
 */
const RETROSPECTIVE_LABELS: Readonly<Record<string, string>> = {
  "hidden-thread": "Secret thread",
  "seeded-relationship": "Hidden tie",
  "hidden-attribute": "Hidden side",
  confessional: "Confessional",
  "offscreen-event": "Off-screen",
  gossip: "Whisper",
  conversation: "Off-screen",
  scheme: "Off-screen",
};
function retrospectiveLabel(kind: string): string {
  if (RETROSPECTIVE_LABELS[kind]) return RETROSPECTIVE_LABELS[kind]!;
  // Fallback: de-slug an unmapped kind ("some-kind" → "Some kind") so no raw machine slug ever shows.
  const words = kind.replace(/[:_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Hidden";
}

/**
 * A fresh entropy seed for a game created WITHOUT an explicit seed (E39/C7): a uint32 from
 * `crypto` randomness, persisted in the snapshot (`gameSeed`) so the season stays reproducible
 * AFTER creation. This is an adapter (not the pure core) — the one sanctioned place real
 * entropy enters; everything downstream still flows through the seeded `RandomnessSource`.
 */
function entropySeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

/**
 * Flatten untrusted FE text before it rides into a SYSTEM prompt (the C8 pattern): collapse ALL
 * whitespace (newlines/tabs/control chars that could forge a prompt line) into single spaces and cap the
 * length. Used by the 0062 zeitgeist write-back (`recordWorldSnapshot`) — the snapshot is non-secret
 * public flavor, but it is still player/FE-sourced text woven into the moment prompt.
 */
function sanitizeFlavor(s: string, max = 160): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** The twist kinds the LIVE loop can actually run (0025/B53). The pool may hold more; only these load. */
const IMPLEMENTED_TWISTS: ReadonlySet<TwistKind> = new Set<TwistKind>(["double-eviction"]);

/**
 * Engine-side implementation of the Vault-free game-session port. It runs the
 * OOBE (the one human-authored profile) and holds the active house, then projects
 * it to a Vault-free view: the player's own authored card plus a name-only house
 * roster — NO stats, NO souls, NO archetypes, NO hidden attributes cross the wall.
 *
 * Lives on the ENGINE side (like `EngineCommandsAdapter`); the outward MCP server
 * depends on the `GameSession` port, never on this class or the prompt module.
 */
export class GameSessionAdapter implements GameSession {
  private house: GameHouse | null = null;
  /**
   * R3 — per-houseguest cache for the append-only soul arrays the snapshot export deep-clones every
   * turn (`memory`/`emotionalHistory`). Both are append-only (every off-screen scene pushes a note; the
   * arc samples grow each tick) — the ONLY in-place memory write is `replaceMemoryNote`, which now swaps
   * the array reference so this `(ref,len)`-keyed cache invalidates. Keyed by houseguest id, each entry
   * holds the LIVE source array ref + length + the produced clone. On the next export an UNCHANGED soul
   * (same ref, same length) reuses its clone by reference — O(1) — so the export re-clones only the
   * handful of souls actually touched that turn instead of every soul's full history (audit R3). The
   * cached clone is never mutated (a grown source rebuilds a NEW array), so a baseline snapshot that
   * still references the old clone keeps its point-in-time length — the non-degradation check stays
   * exact. Cleared on `restore` (the live houseguest objects are replaced wholesale).
   */
  private readonly soulCloneCache = new Map<EntityId, {
    memSrc: readonly string[]; memLen: number; memClone: string[];
    histSrc: readonly number[]; histLen: number; histClone: number[];
  }>();
  private week = 0;
  private phase = "setup";
  /**
   * The casting interview's incremental intake (0050). OOBE is no longer atomic: the producer
   * records answers as they land (`updateCasting`), this accumulates them pre-game, and
   * `createCharacter` finalizes FROM it. Snapshot-durable so a half-done interview survives a
   * restart (0030); cleared once the season starts.
   */
  private intake: CastingIntake = emptyIntake();
  // Public ceremony state for the status panel (0020). Vault-free: ids → public names only.
  private ceremony: CeremonyState = { nominees: [], vetoUsed: false };
  // The incremental weekly-loop state (0011); null until a game starts.
  private live: LiveSeasonState | null = null;
  /** Save-on-mutation hook (0030); the registry wires it to persist the user's snapshot. */
  private onPersist?: () => void;
  /** Beat-event sink (wired by the registry to record player-witnessed events into the EventStore). */
  private onEvent?: (ev: BeatEvent) => void;
  /** Tracked promises (0039). Player-party deals only here; NPC↔NPC deals live off-screen in the Vault. */
  private readonly deals = new DealLedger();
  /** Records a one-off witnessed event (deal made/broken) and returns its id. Wired by the registry. */
  private onPlayerEvent?: (content: string, witnessSet: EntityId[], type?: string) => string | undefined;
  /** Optional narrator for the snarky tagline (0033); none ⇒ the curated state-aware fallback. */
  private narrator?: NarrativePort;
  /**
   * ENGINE-ONLY dynamic soul (0024) wired into the LIVE sandbox (the 0041 linchpin). When present,
   * consequential beats + off-screen scenes `recordToSoul` so each NPC's arc deepens and their voice
   * can be grounded by `recall`. Optional — standalone adapters (onboarding/tests) still evolve the
   * house's emotional state (modulating competitions) without the recall index.
   */
  private soul?: SoulProvider;
  /** Per-moment tagline cache (regenerate when week/phase/standing changes, not per page load). */
  private readonly taglineCache = new Map<string, string>();
  /**
   * Who is in which room (0049) — every ACTIVE houseguest, exactly one room; the evicted are
   * NOWHERE. Seeded at game start, re-assigned by the off-screen tick (`presenceTick`); grounds
   * witnessing, overhearing, and the player's `whereabouts()` read.
   */
  private presence: Map<EntityId, Room> | null = null;
  /**
   * Room TENURE (L21/L24) — consecutive presence ticks each houseguest has held their CURRENT room
   * (0 = moved this tick). Bumped/reset in `presenceTick` alongside `presence`; grounds scene
   * continuity in `whereabouts()` so the narrator voices who has lingered vs. who just arrived.
   */
  private presenceTenure: Map<EntityId, number> | null = null;
  /**
   * The CALIBRATION-NEUTRAL base occupancy (L21/L24). The off-screen society pairs co-present NPCs to
   * generate hidden scenes whose relationship folds feed (downstream) nominations/votes — so the
   * society's occupancy is calibration-LOAD-BEARING. To keep the seeded competition/vote outcomes
   * BYTE-IDENTICAL to the pre-personality build, the society reads THIS base assignment (the un-weighted
   * 0049 movement, exactly as before L21/L24) via `societyOccupancy()`, while the player-facing positions
   * (`this.presence`, used by `whereabouts`/witnessing) carry the personality-weighted result. The two
   * differ only in WHICH room NPCs roam to — the player never observes the hidden society's pairing, so
   * there is no observable contradiction (one place at a time still holds for everything the player sees).
   */
  private presenceBase: Map<EntityId, Room> | null = null;
  /**
   * The presence-tick COUNTER (L21/L24 isolation). Movement randomness rides a DEDICATED stream forked
   * off the game seed + this counter (`presenceTick`) — never the orchestrator's shared per-user stream
   * that drives the off-screen society + relationship folds + votes — so personality-weighted movement
   * can never perturb the seeded competition/vote calibration (`tests/property/juryReach`). Persisted, so
   * the movement trajectory stays reproducible across a restart. Advances ONCE per `presenceTick`.
   */
  private presenceTickCount = 0;
  /** The game's seed (B60/E12): per-moment rng keys off it — two same-named games never share streams. */
  private gameSeed: number | null = null;
  /** The per-season style anchor for portrait prompts (0051): seeded at cast time, stable through the season. */
  private portraitStyleAnchor: string | null = null;
  /**
   * The move-in zeitgeist snapshot (feature 0062): the ONE frozen, shared real-world flavor the cast
   * moved in WITH — captured once at season creation, FROZEN, persisted, and recalled all season. It
   * colors BOTH the player's moment prompts AND the off-screen society/gossip prompts (§5) and goes
   * stale as the weeks pass (§7). OUTWARD-SAFE public flavor (§6) — never a Vault handle, never a game
   * input. Null pre-game / when no snapshot was captured (the §8 fail-soft skip).
   */
  private worldSnapshot: WorldSnapshot | null = null;
  /**
   * The PRODUCER persona's seed (producer-persona feature). The producer is a REAL generated
   * character — as deep a persona as any houseguest, built by the same `CharacterFactory` machinery —
   * but OFF-CAMERA: no headshot, never one of the 16, never in the roster/portraits/whereabouts. The
   * casting interview voices it CONSISTENTLY. It must be stable BEFORE the season starts (the interview
   * is pre-game) AND through the game, so its seed is established LAZILY the first time it's needed
   * (pre-game) via real entropy, PERSISTED in the snapshot, and reused at `createCharacter`. Same seed
   * → same producer (reproducible across turns and a restart). Null until first established.
   */
  private producerSeed: number | null = null;
  /** Memoized producer for `producerSeed` (rebuilt on restore / when the seed is first set). */
  private producerCache: Producer | null = null;

  // ─── PREMIERE meet-everyone tracker (feature #380 follow-on) — NEW BLOCK ─────────────────────────
  /**
   * The houseguests the player has been INTRODUCED to during the premiere. The STRUCTURAL guarantee
   * that every NPC is met before the first HOH does NOT rely on the model to remember (it failed — it
   * skipped people): the engine tracks who's met here, surfaces "who's left to introduce" into the
   * premiere moment prompt, and exposes a `complete` gate. The player is implicitly met (they ARE the
   * player); only NPCs accumulate here. Seeded empty at move-in; persisted (0030) so a half-done
   * premiere resumes; cleared once the premiere is over. PUBLIC ids only — no Vault data.
   */
  private premiereMet: Set<EntityId> = new Set();
  // ─────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The live relationship model drives NPC decisions (threat/trust). The registry
   * injects the SAME instance the consequence fold writes to, so the player's actions
   * shape how the house nominates and votes over time. Standalone (tests/onboarding)
   * it owns a fresh model — the loop still runs, just without cross-fold history.
   */
  constructor(private readonly rel: RelationshipModel = new RelationshipModel(0.5)) {}

  /** Wire a persistence callback invoked after every mutation (durable save, 0030). */
  setOnPersist(fn: () => void): void {
    this.onPersist = fn;
  }

  /**
   * The ONE restart door (audit E1/D1/R1): when composed in the registry, a CONFIRMED
   * `createCharacter` over a started game is delegated here — the registry routes it through the
   * same `resetUser` the admin reset uses (orchestrator baseline forgotten, dead season's saves
   * rotated, a clean sandbox) and season 2 is created in the fresh sandbox. Standalone adapters
   * (tests/onboarding fixtures with no registry) keep the legacy in-place restart.
   */
  private onRestart?: (req: CreateCharacterReq) => GameStateView;

  setOnRestart(fn: (req: CreateCharacterReq) => GameStateView): void {
    this.onRestart = fn;
  }

  /**
   * One persisted commit per player mutation (audit E3): a beat used to fire `onPersist` mid-method
   * (a broken deal inside the tally) and again at the end — and since the commit hook can SWAP the
   * sandbox on a fault, the old instance kept executing against rolled-back state. Mutations run
   * inside `inOneCommit`, which defers every interior `persist()` to a single hook call at the end;
   * a refused commit then throws OUT of the mutation (nothing narrates a beat that never happened).
   */
  private persistDepth = 0;
  private persistDeferred = false;

  private persist(): void {
    if (this.persistDepth > 0) {
      this.persistDeferred = true;
      return;
    }
    this.onPersist?.();
  }

  private inOneCommit<T>(fn: () => T): T {
    this.persistDepth++;
    let out: T;
    try {
      out = fn();
    } finally {
      this.persistDepth--;
    }
    if (this.persistDepth === 0 && this.persistDeferred) {
      this.persistDeferred = false;
      this.onPersist?.(); // may throw (a refused/failed commit) — AFTER all state mutation (E3)
    }
    return out;
  }

  /** Wire the beat-event sink (the registry records each as a player-witnessed event). */
  setOnEvent(fn: (ev: BeatEvent) => void): void {
    this.onEvent = fn;
  }

  /** Wire the one-off witnessed-event recorder (deal made/broken reveals, 0039). */
  setOnPlayerEvent(fn: (content: string, witnessSet: EntityId[], type?: string) => string | undefined): void {
    this.onPlayerEvent = fn;
  }

  /** Wire a narrator for the snarky tagline (0033). Without one, the curated fallback is used. */
  setNarrator(narrator: NarrativePort): void {
    this.narrator = narrator;
  }

  /** Wire the engine-only soul store (0041) so the live loop deepens souls + can recall (0024). */
  setSoul(soul: SoulProvider): void {
    this.soul = soul;
  }

  /** Reserve-twist slots for a new game (0016 knob: the admin sets the COUNT, never the content). */
  private twistCount = 2;

  setTwistCount(n: number): void {
    this.twistCount = Math.max(0, Math.floor(n));
  }

  /** Vault audit-copy hook (0025/B53): the registry seals the loaded twists into the engine's Vault. */
  private onSeal?: (reserve: readonly ReserveTwist[]) => void;

  setOnSeal(fn: (reserve: readonly ReserveTwist[]) => void): void {
    this.onSeal = fn;
  }

  /**
   * Deep-profile seal hook (feature 0058): the registry seals each NPC's HIDDEN profile + story
   * threads into the engine's Vault AND indexes them into the soul for full-fidelity recall (L27b) —
   * exactly the seam `setOnSeal` uses for reserve twists. Engine-only: the sealed content is a secret
   * (off the player AND admin), so it rides this hook, never an outward projection.
   */
  private onSealProfiles?: (
    profiles: ReadonlyArray<{ id: EntityId; profile: DeepProfile }>,
    threads: readonly StoryThread[],
  ) => void;

  setOnSealProfiles(
    fn: (profiles: ReadonlyArray<{ id: EntityId; profile: DeepProfile }>, threads: readonly StoryThread[]) => void,
  ): void {
    this.onSealProfiles = fn;
  }

  /**
   * RE-seal ONE houseguest's authored profile + threads (L28b write-back) — REPLACING that subject's
   * prior Vault records (idempotent, no duplication), unlike `onSealProfiles` which appends the cast at
   * birth. Engine-only by construction (the registry wires it to the Vault via `replaceHidden`).
   */
  private onResealProfile?: (id: EntityId, profile: DeepProfile, threads: readonly StoryThread[]) => void;

  setOnResealProfile(fn: (id: EntityId, profile: DeepProfile, threads: readonly StoryThread[]) => void): void {
    this.onResealProfile = fn;
  }

  /**
   * The engine-only HIDDEN deep layer (0058) — the §3 secrets/goals/weakness/Day-1 perception per NPC
   * and the derived story threads. NEVER projected (the view/npcVoice/portrait paths never read this);
   * sealed into the Vault at seal time and persisted through the Vault snapshot. Kept here so the
   * thread-activation fold (`activateThread`) and the Day-1 edge seeding can read them in-process.
   */
  private deepProfiles: Record<EntityId, DeepProfile> = {};
  private storyThreads: StoryThread[] = [];

  /**
   * The engine-only HIDDEN seeded relationship layer (0059): sparse pre-game ties + showmances, sealed
   * off the player AND admin. NEVER projected (no view/npcVoice/portrait/moment path reads it); sealed
   * into the Vault at seed time and persisted in the snapshot. The admin may set the per-season COUNT
   * budget (0016-style) — never the content.
   */
  private seededRels: SeededRelationships = { ties: [], showmances: [] };
  private tieBudget = DEFAULT_TIE_BUDGET;
  private showmanceBudget = DEFAULT_SHOWMANCE_BUDGET;

  /**
   * The engine-only HIDDEN private-orientation map (feature 0063): the orientation of each houseguest
   * who holds it PRIVATELY (closeted / not-yet-out). NEVER projected — no view/npcVoice/portrait/moment
   * path reads it; sealed into the Vault at cast time (via `onSealPrivateOrientations`) and persisted in
   * the snapshot. It surfaces to the player ONLY through a modeled 0002 pathway, exactly as a 0058 secret
   * does. PUBLIC (out) orientations are NOT here — they ride on the Character as `outOrientation`.
   */
  private privateOrientations: Record<EntityId, Orientation> = {};

  /**
   * The ethnicity-grounded skin-tone cue per NPC id (feature 0063) — set by `seedDiversity`, read by
   * `seedDeepProfiles` to ground `physicalCharacteristics.skinTone` so the text and the portrait agree
   * with the guaranteed heritage. PUBLIC, Vault-free (it's a complexion phrase, already on the card);
   * transient (re-derivable from the ethnicity facet), so it is NOT separately persisted.
   */
  private groundedSkinTones: Record<EntityId, string> = {};

  /**
   * Seal hook for the HIDDEN private orientations (feature 0063) — the registry writes the Vault audit
   * copy + recall index, exactly like `onSealProfiles`. Engine-only: a private orientation is a secret
   * (off the player AND admin), so it rides this hook, never an outward projection.
   */
  private onSealPrivateOrientations?: (entries: ReadonlyArray<{ id: EntityId; orientation: Orientation }>) => void;

  setOnSealPrivateOrientations(fn: (entries: ReadonlyArray<{ id: EntityId; orientation: Orientation }>) => void): void {
    this.onSealPrivateOrientations = fn;
  }
  private onSealSeededRels?: (rels: SeededRelationships) => void;

  setOnSealSeededRels(fn: (rels: SeededRelationships) => void): void {
    this.onSealSeededRels = fn;
  }

  /**
   * 0059/L40 — fired when a seeded showmance crosses into `visible`: the registry wires this to record
   * a PLAYER-witnessed (public, non-hidden) house event, so the player learns of the romance through a
   * real pathway (0002) and the narrator may voice it. Engine-only seam (the adapter holds no events).
   */
  private onShowmanceSurfaced?: (sm: { a: EntityId; b: EntityId; aName: string; bName: string }) => void;

  setOnShowmanceSurfaced(fn: (sm: { a: EntityId; b: EntityId; aName: string; bName: string }) => void): void {
    this.onShowmanceSurfaced = fn;
  }

  /**
   * 0060 §4.2 — the surfacing seams the thread scheduler uses (NPC↔NPC gossip vs. a rare to-the-player
   * pathway). The adapter holds NO events/knowledge handle, so it hands the registry a Vault-SAFE
   * paraphrase (never the premise — `threadRumor` keyed by source class) and the registry runs the
   * 0038 gossip diffusion / 0002 `surfaceInformationTo` (with genuine content lineage, E9). Returns
   * whether the surfacing actually reached the player (so the scheduler can count it for restraint).
   */
  private onThreadGossip?: (origin: EntityId, rumor: string, subject: EntityId) => void;
  private onThreadSurfaceToPlayer?: (subject: EntityId, rumor: string) => boolean;

  setOnThreadGossip(fn: (origin: EntityId, rumor: string, subject: EntityId) => void): void {
    this.onThreadGossip = fn;
  }

  setOnThreadSurfaceToPlayer(fn: (subject: EntityId, rumor: string) => boolean): void {
    this.onThreadSurfaceToPlayer = fn;
  }

  /**
   * 0060 §3 (`nominated-twice`) — engine-only, hidden bookkeeping: the DISTINCT weeks each houseguest
   * has been on the block, accrued each schedule tick from the live ceremony nominees. Persisted in the
   * snapshot so the count survives a restart (0030); never projected. Absent on pre-0060 saves (rebuilt
   * from the current ceremony onward — at worst a thread waits one extra block to ripen, never leaks).
   */
  private nominationWeeks: Record<EntityId, number[]> = {};
  /** 0060 — the count of threads that have ever SURFACED this season (the hard restraint cap, §5). */
  private surfacedThreadCount = 0;

  /**
   * The season record providers (0048/B56): the full event record + the Vault's hidden records,
   * wired by the registry. The recap reads only the PUBLIC record; the retrospective reads the
   * hidden side and is gated on the finished terminal state in `seasonRetrospective`.
   */
  private record?: {
    events: () => GameEvent[];
    hidden: () => ReadonlyArray<{ kind: string; content: string }>;
  };

  setRecordProviders(p: {
    events: () => GameEvent[];
    hidden: () => ReadonlyArray<{ kind: string; content: string }>;
  }): void {
    this.record = p;
  }

  /** Per-NPC knowledge readers (B65), wired by the registry from the KnowledgeService. */
  private npcKnowledge?: {
    known: (id: EntityId) => ReadonlyArray<{ content: string }>;
    suspicions: (id: EntityId) => ReadonlyArray<{ content: string }>;
  };

  setNpcKnowledgeProviders(p: {
    known: (id: EntityId) => ReadonlyArray<{ content: string }>;
    suspicions: (id: EntityId) => ReadonlyArray<{ content: string }>;
  }): void {
    this.npcKnowledge = p;
  }

  /** Caps so a long season's voicing context stays tight (prefer removing context — ADR 0003). */
  private static readonly VOICE_KNOWS_CAP = 20;
  private static readonly VOICE_SUSPECTS_CAP = 8;

  /** Resolve a houseguest id by id, else exact name, else an UNAMBIGUOUS first name (audit 2026-06-18
   *  — the model calls npcVoice with a name as often as an id; tolerate both, but never guess between
   *  two people who share a first name). Returns null when unknown/ambiguous. */
  private resolveHouseguestVoiceId(key: string): EntityId | null {
    if (!this.house) return null;
    const npcs = this.house.npcs;
    if (npcs.some((n) => n.id === key)) return key as EntityId;
    const k = key.trim().toLowerCase();
    const byName = npcs.filter((n) => n.name.toLowerCase() === k);
    if (byName.length === 1) return byName[0]!.id;
    const byFirst = npcs.filter((n) => n.name.toLowerCase().split(" ")[0] === k);
    return byFirst.length === 1 ? byFirst[0]!.id : null;
  }

  /**
   * The knowledge-bounded voicing projection for ONE active houseguest (B65 / ADR 0003 §8). The
   * model is HANDED a bounded person: their stable public persona (byte-stable, B61), their room +
   * co-presence (0049), what THEY legitimately know (0002 — which they may, in character, choose
   * to reveal: that is the game), their hunches, and ORGANIC stances (labels through their own
   * disposition — never a number). Everything any OTHER houseguest privately knows, the Vault,
   * and the souls stay out by construction — the model cannot voice what this NPC never learned.
   */
  npcVoice(idOrName: EntityId): NpcVoiceView | null {
    if (!this.house) return null;
    // Name-tolerant lookup (audit 2026-06-18): the narration model reliably calls this with a
    // NAME ("Griffin Suarez") instead of the id ("npc:8"); a strict id-only match returned null and
    // the model then narrated the dead call out loud to the player ("the voice report didn't come
    // back"). Resolve by id first, then exact name, then an unambiguous first-name — so a sensible
    // call always lands and never leaks a backstage miss into the fiction.
    const rid = this.resolveHouseguestVoiceId(idOrName);
    const npc = rid ? this.house.npcs.find((n) => n.id === rid) : undefined;
    if (!npc || this.seatOf(npc.id) !== "active") return null; // only the living are voiced from inside
    const id = npc.id;

    const room = this.presence?.get(id) ?? null;
    const present: NamedRef[] = [];
    if (room && this.presence) {
      for (const [other, where] of this.presence) {
        if (where === room && other !== id) present.push({ id: other, name: this.nameOf(other) });
      }
    }
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const others = [this.house.player.id, ...this.house.npcs.map((n) => n.id)]
      .filter((h) => h !== id && !evicted.has(h));
    return {
      houseguest: { id, name: npc.name },
      persona: {
        archetype: npc.character.archetype,
        strategyStyle: npc.character.strategyStyle,
        background: npc.character.background,
        age: npc.character.age,
        presentation: npc.character.presentation,
        // L28: voice them in their STORED observable register (blunt / deadpan / anxious…), not a default.
        ...(npc.character.demeanor !== undefined ? { demeanor: npc.character.demeanor } : {}),
        // 0058: voice the STORED biography, never invent (and drift) it. Public facet only — the hidden
        // deep profile is never on this projection (the §8 wall).
        ...(npc.character.biography !== undefined ? { biography: npc.character.biography } : {}),
        // L29 single physical descriptor (appearance/physicalCharacteristics consistency): the STRUCTURED
        // facet is the ONE source of truth the portrait + narration share; the prose `appearance` rides
        // ONLY as the pre-0058 fallback — NEVER both at once (they were independently generated and could
        // contradict on build/skin/hair). When the facet is present it alone is voiced.
        ...(npc.character.physicalCharacteristics !== undefined
          ? { physicalCharacteristics: npc.character.physicalCharacteristics }
          : npc.character.appearance !== undefined ? { appearance: npc.character.appearance } : {}),
        // 0063: voice the PUBLIC identity facets — heritage, gender presentation, and a PUBLICLY-OUT
        // orientation only. A PRIVATELY-held orientation is NEVER here (it's Vault-sealed; the houseguest
        // would never lead with it until a pathway surfaces it, §5). One true facet, never the character.
        ...(npc.character.ethnicity !== undefined ? { ethnicity: npc.character.ethnicity } : {}),
        ...(npc.character.genderPresentation !== undefined ? { genderPresentation: npc.character.genderPresentation } : {}),
        ...(npc.character.outOrientation !== undefined ? { outOrientation: npc.character.outOrientation } : {}),
      },
      whereabouts: room ? { room, present } : null,
      knows: (this.npcKnowledge?.known(id) ?? [])
        .slice(-GameSessionAdapter.VOICE_KNOWS_CAP)
        .map((f) => this.humanize(f.content)),
      suspects: (this.npcKnowledge?.suspicions(id) ?? [])
        .slice(-GameSessionAdapter.VOICE_SUSPECTS_CAP)
        .map((f) => this.humanize(f.content)),
      stances: others.map((other) => ({
        toward: { id: other, name: this.nameOf(other) },
        stance: relationshipLabel(this.rel.edge(id, other), dispositionOf(npc.character.archetype)),
      })),
    };
  }

  /**
   * The portrait prompt for one houseguest by id (0051) — Vault-free. Built from PUBLIC appearance
   * facets only (appearance/age/presentation) + the per-season style anchor. Returns null when no
   * game is started or the id is unknown. No stats, soul, or hidden element ever reaches the prompt.
   */
  getPortraitPrompt(id: EntityId): { houseguestId: string; name: string; prompt: string } | null {
    if (!this.house || !this.portraitStyleAnchor) return null;
    const npc = this.house.npcs.find((n) => n.id === id);
    const subject = id === this.house.player.id ? this.house.player : npc;
    if (!subject) return null;
    return buildPortraitPrompt(
      subject.id,
      subject.name,
      {
        appearance: subject.character.appearance,
        age: subject.character.age,
        presentation: subject.character.presentation,
        ...(subject.character.physicalCharacteristics !== undefined
          ? { physicalCharacteristics: subject.character.physicalCharacteristics } : {}),
        // 0063: feed the PUBLIC diversity + personality facets so the shot is uniquely this person — the
        // heritage (an authentic likeness), how they present, and their observable demeanor (vibe/energy).
        // A PRIVATE orientation is NEVER read here (it lives in the engine-only map, not on the Character),
        // so it can never enter a prompt — the §5 Vault rule holds by construction.
        ...(subject.character.ethnicity !== undefined ? { ethnicity: subject.character.ethnicity } : {}),
        ...(subject.character.genderPresentation !== undefined ? { genderPresentation: subject.character.genderPresentation } : {}),
        ...(subject.character.demeanor !== undefined ? { demeanor: subject.character.demeanor } : {}),
      },
      this.portraitStyleAnchor,
    );
  }

  /**
   * The deep-profile write-back seam (feature 0058 / ledger L28b) — the FE producer-LLM authors a
   * houseguest's rich §3 profile and writes it BACK here so the ENGINE becomes the airtight source of
   * truth (mirrors the 0051 portrait handshake). NOW LIVE: it validates (non-player-mirroring),
   * SPLITS across the Vault Wall (PUBLIC biography/physical facet → the byte-stable Character; HIDDEN
   * secrets/goals/weakness/Day-1 perception → the engine-only deep layer + the Vault), re-derives the
   * story threads, re-seeds the NPC→player edge from the new Day-1 read, and re-indexes for full
   * recall — REPLACING the seeded floor for that houseguest (idempotent; no stale/duplicated records).
   *
   * The split is ENFORCED by construction: the result reports PUBLIC and HIDDEN field NAMES on separate
   * lists and NEVER echoes a hidden value — so the seam can never become a wall leak (§8). Any field the
   * author omits keeps its prior (seeded) value, so the profile always stays complete.
   */
  recordCastProfile(req: RecordCastProfileReq): RecordCastProfileResult {
    if (!this.house) return { accepted: false, publicFields: [], hiddenFields: [], reason: "no game started" };
    const target = this.house.npcs.find((n) => n.id === req.houseguestId);
    if (!target) return { accepted: false, publicFields: [], hiddenFields: [], reason: "unknown houseguest" };

    // Validate — non-player-mirroring (L28 + the anti-sycophancy mandate #3): the cast is INDEPENDENT
    // of the player, so NEITHER the authored PUBLIC material NOR the hidden STORYLINE material (secrets,
    // true goals, weakness) may be built around the player — an NPC's drama must not echo the player's
    // name. This is the airtight guard: even if an authoring model ignores the prompt and weaves the
    // player into an NPC's secret/goal/weakness, the engine refuses it here so no player-centric story
    // material is ever sealed. The Day-1 read of the player is the ONE legitimately player-facing field
    // and is excluded from this check (the engine owns its seeded value regardless). Vault-safe: the
    // refusal echoes no authored value. (A short player name is ignored to avoid false positives.)
    const playerName = (this.house.player.name ?? "").trim();
    const mentionsPlayer = (text: string): boolean =>
      playerName.length >= 3 && text.toLowerCase().includes(playerName.toLowerCase());
    const publicText = `${req.biography ?? ""} ${req.physicalCharacteristics ? Object.values(req.physicalCharacteristics).join(" ") : ""}`;
    const storylineText = `${(req.secrets ?? []).join(" ")} ${(req.trueGoals ?? []).join(" ")} ${req.weakness ?? ""}`;
    if (mentionsPlayer(publicText) || mentionsPlayer(storylineText)) {
      return { accepted: false, publicFields: [], hiddenFields: [], reason: "authored profile mirrors the player" };
    }

    // Field NAMES only — never the values (a hidden value must never ride out on the result, §8).
    const publicFields = (["biography", "physicalCharacteristics"] as const).filter((f) => req[f] !== undefined);
    const hiddenFields = (["secrets", "trueGoals", "weakness", "dayOnePerception"] as const)
      .filter((f) => req[f] !== undefined);

    // (1) PUBLIC fold onto the byte-stable Character — these cross to the player.
    if (req.biography !== undefined) target.character.biography = req.biography;
    if (req.physicalCharacteristics !== undefined) target.character.physicalCharacteristics = req.physicalCharacteristics;

    // (2) HIDDEN: merge the authored fields over the prior profile so it stays complete. The prior is
    // the seeded floor (always present after seedDeepProfiles; regenerate deterministically if missing).
    // The author supplies the Day-1 read as PROSE only — the engine KEEPS the calibrated seeded leans
    // (anti-sycophancy: the LLM authors flavor, never the hidden weights; this also preserves the
    // net-zero perception balance the juryReach gate depends on). Only the read TEXT is authored.
    const prev: DeepProfile = this.deepProfiles[target.id]
      // Coherence floor (P1): when no prior profile exists, the seeded fallback is now CHARACTER-
      // CONDITIONED off the target's own archetype/vocation/age (never the player) — a coherent
      // individual hidden life, not a flat shared-pool draw. The narrative text rides a DEDICATED
      // sub-stream (#392 RNG-isolation), matching the cast-layer key so the fallback agrees with it.
      ?? generateDeepProfile(
        new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:deep-hidden:${target.name}`)),
        undefined,
        target.character,
        hashSeed(`${this.gameSeed ?? 0}:deep-narrative:${target.name}`),
      );
    const next: DeepProfile = {
      secrets: req.secrets ?? prev.secrets,
      trueGoals: req.trueGoals ?? prev.trueGoals,
      weakness: req.weakness ?? prev.weakness,
      dayOnePerception: req.dayOnePerception !== undefined
        ? { ...prev.dayOnePerception, read: req.dayOnePerception }
        : prev.dayOnePerception,
    };
    this.deepProfiles[target.id] = next;

    // (3) Re-derive THIS source's story threads (replace), deterministic off the name. The NPC→player
    // edge keeps its seeded lean (the engine owns the numbers — see above), so no edge re-seed here.
    const thrRng = new SeededRandom(hashSeed(`${this.gameSeed ?? 0}:deep-thread-authored:${target.name}`));
    this.storyThreads = this.storyThreads.filter((t) => t.sourceId !== target.id)
      .concat(deriveStoryThreads(thrRng, target.id, next));

    // (4) Full-fidelity recall (L27b): replace the prior deep-profile note in the authoritative soul
    // memory (engine-only; never crosses) so the authored detail is recall-able in full and persists +
    // re-indexes on restore. Also index it NOW for same-session recall.
    const oldNote = deepProfileToVaultContent(target.id, prev);
    const newNote = deepProfileToVaultContent(target.id, next);
    const idx = target.soul.memory.lastIndexOf(oldNote);
    if (idx >= 0) {
      // R3 — the ONLY in-place same-length memory write. Swap the array REFERENCE (not just the slot)
      // so the snapshot clone cache's `(ref,len)` reuse key invalidates and the authored note is not
      // lost behind a stale clone. The replacement is content-preserving in spirit (re-derived authored
      // detail, never a deletion), so non-degradation still holds.
      target.soul.memory = target.soul.memory.slice();
      target.soul.memory[idx] = newNote;
    } else {
      target.soul.memory.push(newNote);
    }
    this.soul?.recordToSoul(target.id, newNote);

    // (5) Re-seal into the Vault — REPLACING this subject's prior profile + thread records (idempotent).
    this.onResealProfile?.(target.id, next, this.storyThreads.filter((t) => t.sourceId === target.id));

    return { accepted: true, publicFields: [...publicFields], hiddenFields: [...hiddenFields], reason: "authored profile sealed (live)" };
  }

  /** The season's public arc from the event record (0048) — Vault-free, stores-not-memory. */
  seasonRecap(): SeasonRecapView {
    const events = this.record?.events() ?? [];
    // The structural filter: ceremony beats land as `season:` events; deals/betrayal reveals are
    // their own recorded types. All player-witnessed by construction — this is the public record.
    const highlights = events
      .filter((e) => !e.hidden && (e.id.startsWith("season:") || e.type === "deal" || e.type === "betrayal"))
      .map((e) => e.content);
    return {
      started: this.house !== null,
      finished: !!this.live?.finished,
      winner: this.named(this.live?.winner),
      weeksPlayed: this.week,
      highlights,
      evicted: (this.live?.evictionOrder ?? []).map((id) => ({ id, name: this.nameOf(id) })),
      deals: this.deals.forParty(PLAYER).map((d) => this.dealView(d)),
    };
  }

  /**
   * The Vault unsealing (0048 §1) — the Wall's ONE sanctioned exception, and THE GATE lives here:
   * a live (or unstarted) season returns null, enforced by the terminal state in code, never by
   * prompt. Post-season it returns the real story: every hidden event (off-screen scheming, NPC
   * confessionals, gossip) plus the producer's sealed twists — fired and unfired alike.
   */
  seasonRetrospective(): RetrospectiveView | null {
    if (!this.live?.finished) return null; // the structural gate: no finished season, no unsealing
    const nameOf = (id: EntityId): string => this.nameOf(id);
    const events = this.record?.events() ?? [];
    // The FE renders each row as "[type] content", so `type` must be a READABLE label (not a raw kind
    // slug) and `content` clean, name-resolved prose — this is the Wall's ONE sanctioned reveal, shown
    // readably (audit: the live dump leaked "[hidden-thread] story-thread thread:npc:8:0 …").
    const hiddenStory = events
      .filter((e) => e.hidden)
      .map((e) => ({ type: retrospectiveLabel(e.type), content: this.retroScrub(e.content) }));
    // The structured hidden layers (threads + seeded relationships) render from the IN-MEMORY objects,
    // not their engine-only Vault audit strings — so every id is a NAME and no machine slug crosses. They
    // are therefore SKIPPED below when iterating the Vault records (rendered here once, readably, instead).
    for (const t of this.storyThreads) {
      hiddenStory.push({ type: "Secret thread", content: storyThreadToRetrospectiveProse(t, nameOf) });
    }
    for (const tie of this.seededRels.ties) {
      hiddenStory.push({ type: "Hidden tie", content: preGameTieToRetrospectiveProse(tie, nameOf) });
    }
    for (const s of this.seededRels.showmances) {
      hiddenStory.push({ type: "Hidden tie", content: showmanceToRetrospectiveProse(s, nameOf) });
    }
    for (const r of this.record?.hidden() ?? []) {
      // Rendered structurally elsewhere: twists via `twists` below; threads + seeded relationships from
      // the structured objects above (their raw Vault strings carry ids/slugs we must not echo).
      if (r.kind === "reserved-twist" || r.kind === "hidden-thread" || r.kind === "seeded-relationship") continue;
      hiddenStory.push({ type: retrospectiveLabel(r.kind), content: this.retroScrub(r.content) });
    }
    const fired = new Map((this.live.firedTwists ?? []).map((t) => [t.kind as string, t.beat]));
    const twists = (this.live.reserve ?? []).map((t) => ({
      kind: t.kind as string,
      firedWeek: fired.get(t.kind) ?? null,
    }));
    // E12: the weekly secret ballots unseal HERE — and only here, behind the same terminal gate.
    const evictionVotes = (this.live.voteRecord ?? []).map((r) => ({
      week: r.week,
      evictee: { id: r.evictee, name: this.nameOf(r.evictee) },
      votes: Object.entries(r.voteOf).map(([voter, votedFor]) => ({
        voter: { id: voter as EntityId, name: this.nameOf(voter as EntityId) },
        votedFor: { id: votedFor, name: this.nameOf(votedFor) },
      })),
    }));
    return { winner: this.named(this.live.winner), hiddenStory, twists, evictionVotes };
  }

  /**
   * ADMIN fast-forward to the finale (L38) — the dev-only "finish my season so the post-season
   * retrospective unseals" lever. It DRIVES the existing deterministic loop: it loops `advanceGame`,
   * and whenever the loop stops on a PLAYER pending decision it auto-resolves it with the loop's OWN
   * legal NPC policy (`autoDecision` — the same rulebook the live game already uses, no second one),
   * until a winner is crowned (or the game is already finished). The player can legitimately lose on
   * the way — that is fine, the season still finishes for the rest, and the retrospective opens.
   *
   * VAULT-FREE BY CONSTRUCTION: it reads NO Vault state and returns NO Vault content — only PUBLIC
   * ceremony facts (the crowned winner's NAME, weeks, the player's seat). It does NOT touch
   * `seasonRetrospective`'s gate: that still fires ONLY post-finale through its own code path — this
   * just makes the live season reach the terminal state legitimately. BOUNDED: a hard max-iterations
   * guard means it can never spin forever (a stuck loop returns the unfinished summary, never hangs).
   *
   * Engine-side, ADMIN-channel only (wired through `AdminPort.advanceToFinale`, never the player
   * channel). Each beat still flows through the normal `commit` (consequence fold + persistence),
   * so the finished season is GENUINE — the integrity is preserved absolutely.
   */
  advanceToFinale(): FinaleFastForwardView {
    if (!this.house || !this.live) {
      return { finished: false, winnerName: null, weeks: this.week, playerPlacement: "unknown", started: false };
    }
    // The loop is bounded: a full 16-cast season is well under a few thousand beats+decisions; the
    // cap is generously above that so a legitimately long game still finishes, but a wedged loop
    // (the engine somehow never advancing) can NEVER spin forever — it falls out with the current
    // (unfinished) summary instead of hanging the request.
    const MAX_ITERS = 20_000;
    for (let i = 0; i < MAX_ITERS && !this.live.finished; i++) {
      if (this.live.pending) {
        // Auto-resolve the player's pending with the loop's own legal NPC policy (no second rulebook,
        // B55/D12). `submitDecision` runs the SAME commit path a live decision does (folds + persist).
        const input = autoDecision(this.live, this.ctx(), this.beatRng());
        this.submitDecision(this.fromDecisionInput(input));
      } else {
        this.advanceGame();
      }
    }
    return this.fastForwardSummary();
  }

  /** Map the engine's internal `DecisionInput` (autoDecision's output) back onto the outward
   *  `SubmitDecisionReq` the adapter accepts — so the fast-forward drives the SAME `submitDecision`
   *  path a live player decision does (one decision rulebook; no bypass of validation or the fold). */
  private fromDecisionInput(input: DecisionInput): SubmitDecisionReq {
    switch (input.kind) {
      case "nominations":
        return { kind: "nominations", choice: [...input.choice] };
      case "veto-decision":
        return { kind: "veto-decision", use: input.use, ...(input.save ? { save: input.save } : {}) };
      case "comp-intent":
        return { kind: "comp-intent", intent: input.intent };
      case "houseguests-choice":
        return { kind: "houseguests-choice", vote: input.pick };
      case "replacement":
        return { kind: "replacement", replacement: input.replacement };
      case "eviction-vote":
        return { kind: "eviction-vote", vote: input.vote };
      case "tie-break":
        return { kind: "tie-break", vote: input.evict };
      case "final-eviction":
        return { kind: "final-eviction", vote: input.evict };
      case "goodbye-message":
        return { kind: "goodbye-message", vote: input.tone, ...(input.message ? { statement: input.message } : {}) };
      case "finale-statement":
        return { kind: "finale-statement", statement: input.statement };
      case "finale-answer":
        return { kind: "finale-answer", appeal: input.appeal };
      case "juror-question":
        return { kind: "juror-question", statement: input.question ?? "" };
      case "juror-vote":
        return { kind: "juror-vote", vote: input.vote };
      case "self-evict": // 0061: the auto-driver never produces a self-evict (it's a deliberate quit) — mapped for exhaustiveness.
        return { kind: "self-evict", confirmed: input.confirmed };
    }
  }

  /** The Vault-free fast-forward summary (L38): public ceremony facts ONLY — winner NAME, weeks,
   *  and the player's seat. No hidden state, no soul, no relationship number ever rides out. */
  private fastForwardSummary(): FinaleFastForwardView {
    const finished = !!this.live?.finished;
    const winner = this.live?.winner;
    const finalTwo = this.live?.finalTwo ?? null;
    const me = this.house?.player.id ?? PLAYER;
    let placement: FinaleFastForwardView["playerPlacement"] = "unknown";
    if (finished) {
      if (winner === me) placement = "winner";
      else if (finalTwo && finalTwo.includes(me)) placement = "runner-up";
      else placement = this.playerStatus() === "jury" ? "jury" : "evicted";
    }
    return {
      finished,
      winnerName: winner ? this.nameOf(winner) : null,
      weeks: this.week,
      playerPlacement: placement,
      started: this.house !== null,
    };
  }

  /** The durable session core (0030): the live house + week/phase/ceremony + loop, losslessly. */
  snapshot(): SessionCore {
    return {
      started: this.house !== null,
      week: this.week,
      phase: this.phase,
      ceremony: { ...this.ceremony, nominees: [...this.ceremony.nominees] },
      // R3 — the house is the per-turn export's dominant cost (each houseguest's append-only
      // `soul.memory` is deep-cloned every turn). `cloneHouse` is byte-identical to `cloneSession`
      // (JSON round-trip) but shares the unchanged souls' clones by reference, so the export re-clones
      // only the souls touched this turn — not the whole, ever-growing history. See `soulCloneCache`.
      house: this.house ? this.cloneHouse(this.house) : null,
      live: this.live ? fastClone(this.live) : null,
      deals: this.deals.serialize(),
      ...(this.presence ? { presence: Object.fromEntries(this.presence) as Record<EntityId, Room> } : {}),
      // L21/L24: the calibration-neutral base occupancy the off-screen society pairs on — persisted so the
      // society's positions stay reproducible across a restart and never reseed from the weighted view.
      ...(this.presenceBase ? { presenceBase: Object.fromEntries(this.presenceBase) as Record<EntityId, Room> } : {}),
      ...(this.presenceTenure ? { presenceTenure: Object.fromEntries(this.presenceTenure) as Record<EntityId, number> } : {}),
      // L21/L24: the dedicated movement stream's tick counter — persisted so the personality-weighted
      // movement trajectory stays reproducible across a restart (absent ⇒ 0).
      ...(this.presenceTickCount > 0 ? { presenceTickCount: this.presenceTickCount } : {}),
      ...(this.gameSeed !== null ? { seed: this.gameSeed } : {}),
      // The producer persona's seed (producer-persona feature) — persisted so the SAME off-camera casting
      // producer is voiced across turns and a restart (it is established pre-game, before any season seed).
      ...(this.producerSeed !== null ? { producerSeed: this.producerSeed } : {}),
      ...(this.portraitStyleAnchor !== null ? { portraitStyleAnchor: this.portraitStyleAnchor } : {}),
      // PREMIERE (feature #380 follow-on): persist who the player has met so a half-done premiere
      // resumes after a restart (0030) — the producer never re-introduces someone or loses track of
      // who's still to meet. Public ids; absent once the premiere is over (the set is then empty).
      ...(this.premiereMet.size > 0 ? { premiereIntros: [...this.premiereMet] } : {}),
      // 0062 — the FROZEN move-in zeitgeist snapshot persists so it is RECALLED (never re-searched) all
      // season and survives a restart byte-identical (§3/§9). Outward-safe public flavor (§6).
      ...(this.worldSnapshot ? { worldSnapshot: cloneSession(this.worldSnapshot) } : {}),
      // A half-done casting interview is durable state too (0050/0030).
      ...(intakeIsEmpty(this.intake) ? {} : { casting: cloneSession(this.intake) }),
      // 0058: the engine-only HIDDEN deep layer — persisted so an ACTIVATED thread stays activated and
      // the Day-1 perception re-seeds identically. ENGINE-ONLY (the snapshot never crosses the wall).
      ...(Object.keys(this.deepProfiles).length ? { deepProfiles: cloneSession(this.deepProfiles) } : {}),
      ...(this.storyThreads.length ? { storyThreads: cloneSession(this.storyThreads) } : {}),
      // 0060 — the scheduler's hidden bookkeeping (nominated-twice ledger + the season surfacing cap),
      // persisted so a driven thread stays driven and the cap is never re-opened by a reload.
      ...(Object.keys(this.nominationWeeks).length ? { nominationWeeks: cloneSession(this.nominationWeeks) } : {}),
      ...(this.surfacedThreadCount > 0 ? { surfacedThreadCount: this.surfacedThreadCount } : {}),
      ...(this.seededRels.ties.length || this.seededRels.showmances.length
        ? { seededRelationships: cloneSession(this.seededRels) } : {}),
      // 0063: the engine-only HIDDEN private-orientation map — persisted so a closeted houseguest's
      // sealed orientation survives a restart losslessly and never silently resets. ENGINE-ONLY (the
      // snapshot never crosses the wall). The PUBLIC facets ride on the persisted Character (byte-stable).
      ...(Object.keys(this.privateOrientations).length
        ? { privateOrientations: cloneSession(this.privateOrientations) } : {}),
    };
  }

  /**
   * R3 — clone the house byte-identically to `cloneSession(house)` while reusing each UNCHANGED soul's
   * append-only array clones (`memory`/`emotionalHistory`) by reference. The per-turn export used to
   * JSON-serialize every houseguest's entire (ever-growing) memory every turn — the O(events) cost
   * behind the late-season latency (audit R3). Per houseguest only the small bounded parts (character +
   * soul scalars) are re-cloned each turn; the two big append-only arrays are re-sliced ONLY when their
   * live source grew (or was rewritten — `replaceMemoryNote` swaps the array ref, invalidating the
   * cache). An unchanged soul (same array ref + length) reuses its prior clone, so the export's
   * per-turn work tracks the souls TOUCHED this turn, not the total accumulated history.
   *
   * Correctness: a cached clone is NEVER mutated in place — a grown source produces a fresh array — so a
   * baseline snapshot still holding the old clone keeps its point-in-time length and the non-degradation
   * checkpoint stays exact (baseline vs candidate counts differ precisely by what grew). Every cloned
   * leaf is an immutable primitive (string/number), so sharing it across snapshots is safe.
   */
  private cloneHouse(house: GameHouse): GameHouse {
    return {
      player: this.cloneHouseguest(house.player),
      npcs: house.npcs.map((n) => this.cloneHouseguest(n)),
    } as GameHouse;
  }

  private cloneHouseguest<T extends GameHouse["player"] | GameHouse["npcs"][number]>(hg: T): T {
    const memSrc = hg.soul.memory;
    const histSrc = hg.soul.emotionalHistory ?? [];
    const cached = this.soulCloneCache.get(hg.id as EntityId);
    // Reuse the prior clone iff the live array is the SAME object at the SAME length (an append grows
    // the length; `replaceMemoryNote` swaps the reference) — otherwise re-slice and re-cache. A slice
    // is a faithful, independent clone of a `string[]`/`number[]` (immutable elements; no deep work).
    const memClone = cached && cached.memSrc === memSrc && cached.memLen === memSrc.length
      ? cached.memClone : memSrc.slice();
    const histClone = cached && cached.histSrc === histSrc && cached.histLen === histSrc.length
      ? cached.histClone : histSrc.slice();
    this.soulCloneCache.set(hg.id as EntityId, {
      memSrc, memLen: memSrc.length, memClone,
      histSrc, histLen: histSrc.length, histClone,
    });
    // Clone the houseguest WITHOUT re-cloning the two big append-only arrays (the whole point — they are
    // handled above). To stay BYTE-identical to `cloneSession(hg)` we must preserve the soul's ORIGINAL
    // key ORDER (JSON.stringify is order-sensitive), so we clone each key in place and merely SUBSTITUTE
    // the (reused-or-fresh) array clone for memory/emotionalHistory at their existing positions — never
    // reorder. `fastClone` handles every other small, bounded field (the static character + soul scalars).
    const soulSrc = hg.soul as unknown as Record<string, unknown>;
    const soul: Record<string, unknown> = {};
    for (const k in soulSrc) {
      if (!Object.prototype.hasOwnProperty.call(soulSrc, k)) continue;
      soul[k] = k === "memory" ? memClone
        : k === "emotionalHistory" ? histClone
        : fastClone(soulSrc[k]);
    }
    const hgSrc = hg as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k in hgSrc) {
      if (!Object.prototype.hasOwnProperty.call(hgSrc, k)) continue;
      out[k] = k === "soul" ? soul : fastClone(hgSrc[k]);
    }
    return out as unknown as T;
  }

  /** Rebuild the live session from a durable snapshot (0030) — resume instead of reset. */
  restore(core: SessionCore): void {
    // R3 — the live houseguest objects are replaced wholesale below, so the per-soul clone cache (keyed
    // on the OLD array references) must be dropped; a stale clone could otherwise be reused for a new
    // soul that happens to match a length, persisting the wrong history.
    this.soulCloneCache.clear();
    this.house = core.house ? cloneSession(core.house) : null;
    this.week = core.week;
    this.phase = core.phase;
    this.ceremony = { ...core.ceremony, nominees: [...core.ceremony.nominees] };
    this.live = core.live ? cloneSession(core.live) : null;
    this.deals.load(core.deals ?? []);
    // Pre-0049 saves carry no presence — migrate forward (the next tick seats everyone afresh).
    this.presence = core.presence ? new Map(Object.entries(core.presence) as [EntityId, Room][]) : null;
    // L21/L24: restore the calibration-neutral base occupancy (absent on pre-L21/L24 saves — the next tick
    // re-seeds it from the weighted positions, which `societyOccupancy` falls back to in the meantime).
    this.presenceBase = core.presenceBase ? new Map(Object.entries(core.presenceBase) as [EntityId, Room][]) : null;
    this.presenceTenure = core.presenceTenure ? new Map(Object.entries(core.presenceTenure) as [EntityId, number][]) : null;
    // L21/L24: restore the dedicated movement stream's tick counter (absent on older saves ⇒ 0).
    this.presenceTickCount = core.presenceTickCount ?? 0;
    this.gameSeed = core.seed ?? null; // pre-B60 saves: fall back to the legacy name-keyed streams
    // The producer persona's seed (producer-persona feature): restore so the SAME off-camera casting
    // producer is voiced after a restart. Persisted on feature+ saves; on a started game that predates
    // it, fall back to the season seed (the producer becomes the season's producer, exactly as at cast
    // time). A fresh pre-interview session restores none and re-mints lazily on first need.
    this.producerSeed = core.producerSeed ?? core.seed ?? null;
    this.producerCache = null; // rebuilt from the (possibly new) seed on next read
    // 0051: restore the per-season portrait style anchor. On a legacy save that predates it, re-seed
    // from the game seed (so the look stays stable for a resumed game), or fall back to the first
    // variant when there's no seed either — either way the season looks like itself.
    this.portraitStyleAnchor = core.portraitStyleAnchor
      ?? (core.house
        ? (core.seed !== undefined
          ? STYLE_ANCHOR_VARIANTS[new SeededRandom(hashSeed(`${core.seed}:portrait-style`)).int(STYLE_ANCHOR_VARIANTS.length)]
          : STYLE_ANCHOR_VARIANTS[0])
        : null);
    this.intake = core.casting ? cloneSession(core.casting) : emptyIntake();
    // PREMIERE (feature #380 follow-on): restore who's been met so a half-done premiere resumes (0030).
    // Absent on a pre-feature save OR once the premiere is over ⇒ empty (no one outstanding to re-meet).
    this.premiereMet = new Set(core.premiereIntros ?? []);
    // 0062 — restore the FROZEN move-in zeitgeist snapshot (recalled, never re-searched, §9). Persisted on
    // 0062+ saves; on a pre-0062 save WITH a seed, re-derive the deterministic `model-framed` snapshot off
    // the SAME seed hinge (seed-stable & player-independent, so it returns identically). Without a seed
    // (pre-B60 legacy) or a house, it stays absent — the game degrades to C32's per-reference behavior (§8).
    this.worldSnapshot = core.worldSnapshot
      ? cloneSession(core.worldSnapshot)
      : (core.house && core.seed !== undefined
        ? buildWorldSnapshot({ seed: core.seed, capturedFor: "move-in day" })
        : null);
    // 0058: restore the engine-only HIDDEN deep layer (secrets/goals/weakness/perception + thread
    // status). Persisted on 0058+ saves; on a pre-0058 (or twist-less legacy) save it is re-derived
    // deterministically from the seed + cast below — seed-stable & player-independent, so the floor
    // returns identically. The PUBLIC facets ride on the persisted Character (byte-stable), so they
    // are NOT re-derived here; only the hidden half + thread status are rehydrated.
    if (core.deepProfiles || core.storyThreads) {
      this.deepProfiles = core.deepProfiles ? cloneSession(core.deepProfiles) : {};
      this.storyThreads = core.storyThreads ? cloneSession(core.storyThreads) : [];
    } else if (core.house && core.seed !== undefined) {
      const layer = generateCastDeepLayer(core.seed, core.house.npcs);
      this.deepProfiles = layer.hidden;
      this.storyThreads = layer.threads;
    } else {
      this.deepProfiles = {};
      this.storyThreads = [];
    }
    // 0060 §3 back-compat: a thread restored from a pre-0060 save carries no structured `triggerCondition`
    // / `lifecycleWeek` — default them by source class / the live week (idempotent), so the scheduler has
    // a gate and the windows have a base. This is a NON-mutating re-derive (the byte-stable PUBLIC facets
    // are untouched); the hidden thread gains a field that was always implied by its prose trigger.
    for (const t of this.storyThreads) {
      if (t.triggerCondition === undefined) t.triggerCondition = defaultTriggerConditionFor(t);
      if (t.lifecycleWeek === undefined) t.lifecycleWeek = this.week;
    }
    // 0060 — restore the scheduler's hidden bookkeeping (nominated-twice ledger + the season cap). Absent
    // on pre-0060 saves ⇒ start fresh (rebuilt forward; the cap re-baselines to 0 — a benign, never-leaky
    // relaxation on a legacy resume, since pre-0060 saves carried no surfaced threads to over-count).
    this.nominationWeeks = core.nominationWeeks ? cloneSession(core.nominationWeeks) : {};
    this.surfacedThreadCount = core.surfacedThreadCount ?? 0;
    // 0063 — restore the engine-only HIDDEN private orientations (a closeted orientation must never
    // silently reset) FIRST, so the 0059 showmance re-derive below can read them for its eligibility gate.
    // Persisted on 0063+ saves; on a pre-0063 (or legacy) save with a seed, re-derive deterministically —
    // the diversity layer keys off the cast names + seed, so it returns identically (and the PUBLIC facets
    // already ride on the persisted Character, byte-stable). No re-seal on restore: the Vault already
    // holds the audit copy from cast time (idempotent).
    if (core.privateOrientations) {
      this.privateOrientations = cloneSession(core.privateOrientations);
    } else if (core.house && core.seed !== undefined && !core.house.npcs.some((n) => n.character.ethnicity)) {
      // Only re-derive for a TRULY pre-0063 cast (no ethnicity folded). A 0063 cast with an empty
      // private map simply had everyone publicly out — keep it empty, never invent a secret.
      this.privateOrientations = { ...generateDiversityLayer(core.seed, core.house.npcs).privateOrientations };
    } else {
      this.privateOrientations = {};
    }
    // 0059 — the seeded relationship layer persists explicitly (a showmance STAGE must never silently
    // reset on restore). Absent on pre-0059 saves ⇒ re-seed deterministically off the persisted seed,
    // gated by the 0063 showmance-eligibility predicate (which reads the just-restored identities).
    if (core.seededRelationships) {
      this.seededRels = cloneSession(core.seededRelationships);
    } else if (core.house && core.seed !== undefined) {
      this.seededRels = loadSeededRelationships(
        core.house.npcs, this.tieBudget, this.showmanceBudget,
        new SeededRandom(hashSeed(`${core.seed}:seeded-relationships`)),
        this.showmanceEligiblePredicate(),
      );
    } else {
      this.seededRels = { ties: [], showmances: [] };
    }
    this.rebuildSoulIndex();
    this.wireDispositions(); // re-derive archetype dispositions from the persisted Character (B55)
  }

  /**
   * Rebuild the (derived) soul recall index from the persisted arc after a restore (0030/0041). The
   * AUTHORITATIVE arc lives in each houseguest's `soul.memory`/`emotionalHistory` (persisted
   * losslessly with the house); the vector index is re-derived so `recall` keeps working post-restart.
   */
  private rebuildSoulIndex(): void {
    if (!this.house || !this.soul) return;
    for (const hg of [this.house.player, ...this.house.npcs]) {
      for (const note of hg.soul.memory) this.soul.recordToSoul(hg.id, note);
    }
  }

  /** Engine/loop-internal: record the public ceremony facts the status panel projects. */
  updateCeremony(partial: Partial<CeremonyState>): void {
    this.ceremony = { ...this.ceremony, ...partial };
    this.persist();
  }

  private nameOf(id: EntityId): string {
    if (!this.house) return id;
    if (this.house.player.id === id) return this.house.player.name;
    return this.house.npcs.find((n) => n.id === id)?.name ?? id;
  }

  /**
   * PUBLIC roster name → outward name resolver (non-Vault: names are public). Returns undefined
   * for an id NOT on the live roster, so outward prose can fall back rather than echo a raw id.
   * Wired into the player surface (registry) so socialRead names the houseguest instead of "npc:N".
   */
  publicName(id: EntityId): string | undefined {
    if (!this.house) return undefined;
    if (this.house.player.id === id) return this.house.player.name;
    return this.house.npcs.find((n) => n.id === id)?.name;
  }

  /**
   * The PUBLIC house roster (id → public name) — non-Vault: names are public roster facts, nothing
   * else crosses. Wired into the outward `VisibleStateService` (registry) so player-facing event /
   * knowledge content names houseguests instead of echoing raw `npc:N` ids (audit R4-03 / C-01).
   * Empty before the house exists.
   */
  publicRoster(): { id: EntityId; name: string }[] {
    if (!this.house) return [];
    return [
      { id: this.house.player.id, name: this.house.player.name },
      ...this.house.npcs.map((n) => ({ id: n.id, name: n.name })),
    ];
  }

  private card(id?: EntityId): { id: EntityId; name: string } | null {
    return id ? { id, name: this.nameOf(id) } : null;
  }

  gameStatus(): PublicGameStatus {
    return {
      week: this.week,
      phase: this.phase,
      day: dayOfWeek(this.phase), // E58: the canonical beat→day index (hoh=1 … eviction=5), or null off-ladder
      hoh: this.card(this.ceremony.hoh),
      nominees: this.ceremony.nominees.map((id) => ({ id, name: this.nameOf(id) })),
      veto: {
        holder: this.card(this.ceremony.vetoHolder),
        used: this.ceremony.vetoUsed,
        // E35/audit C-03: the drawn six (the witnessed chip draw) — empty before the draw, so the
        // narrator names THESE exact players rather than inventing who competes. Read straight off
        // the live field (persisted, 0030); cleared with the rest of the week's ceremony state.
        players: (this.live?.vetoField ?? []).map((id) => ({ id, name: this.nameOf(id) })),
      },
      // The live pending (Vault-free legal options) so the decision card re-arms from engine truth
      // on reload — not the FE's process-local last-seen cache, which a FE restart wipes.
      pending: this.pendingView(),
    };
  }

  /** The houseguests still in the game (player + non-evicted NPCs) — the legal references for an
   *  interaction (B39). Empty before a game starts. */
  livingIds(): EntityId[] {
    if (!this.house) return [];
    const evicted = new Set(this.live?.evictionOrder ?? []);
    return [this.house.player.id, ...this.house.npcs.filter((n) => !evicted.has(n.id)).map((n) => n.id)];
  }

  /** The houseguests presence tracks: the living, MINUS an evicted player (the evicted are nowhere). */
  private presenceActive(): EntityId[] {
    const evicted = new Set(this.live?.evictionOrder ?? []);
    return this.livingIds().filter((id) => !evicted.has(id));
  }

  /**
   * The room-assignment deps. `affinity` (allies drift together) + the HOH-room pull are always present;
   * the per-NPC MOVEMENT PERSONALITY (L21/L24) is included ONLY when `weighted` — it reads the static
   * CHARACTER `stats.social` and the dynamic SOUL `volatility` (facts the engine already holds) so a
   * social butterfly roams and seeks company while a low-social/settled one holds a room. The profile
   * NEVER draws rng; it only re-weights the move-gate threshold and the affinity pull (the L21/L24
   * isolation guarantee). No number crosses the Vault Wall — presence reads stay Vault-free.
   *
   * ONLY NPCs are personality-weighted — the PLAYER returns `null` (no profile). The player is a person
   * the engine never relocates (moved only by `movePlayer`), so weighting their movement is meaningless;
   * keeping them un-weighted ALSO makes the player's room identical in the weighted and base views, which
   * keeps the calibration-neutral base fully invariant to the personality constants (the NPCs cluster
   * around the same player room in both).
   */
  private presenceDeps(rng: RandomnessSource, weighted: boolean): Parameters<typeof assignRooms>[2] {
    const playerId = this.house?.player.id;
    return {
      rng,
      affinity: (a, b) => this.rel.edge(a, b).affinity,
      hoh: this.ceremony.hoh ?? null,
      ...(weighted
        ? {
            movement: (id: EntityId) => (id === playerId ? null : {
              social: this.statsOf(id).social,
              // A live soul carries the current turbulence; fall back to the settled center (0.5) when
              // there is none (e.g. a standalone adapter without souls) so the term is a no-op there.
              volatility: this.soulObj(id)?.volatility ?? 0.5,
            }),
          }
        : {}),
    };
  }

  /**
   * The DEDICATED, isolated movement RNG stream (L21/L24). Forked off the GAME seed + the persisted
   * presence-tick counter, so it is fully reproducible AND completely separate from the orchestrator's
   * shared per-user stream that drives the off-screen society + relationship folds + competitions/votes.
   * Both the base and the personality-weighted assignment draw from THIS stream — never the shared one —
   * so the movement weighting cannot perturb the seeded competition/vote calibration.
   */
  private movementRng(): SeededRandom {
    const root = this.gameSeed ?? this.house?.player.name ?? "season";
    return new SeededRandom(hashSeed(`${root}:presence-move:${this.presenceTickCount}`));
  }

  /**
   * Re-seat the house for a new off-screen tick (0049): every active houseguest stays put or moves
   * to an ADJACENT room, clustered by affinity + personality (L21/L24). The orchestrator calls this
   * once per tick; lingering player turns never move the week — only the rooms.
   *
   * THE CALIBRATION INVARIANT (L21/L24 — the jury-reach root cause). The off-screen society pairs
   * CO-PRESENT NPCs, so its occupancy is calibration-LOAD-BEARING (it feeds relationship folds →
   * nominations/votes downstream). Before this feature, `presenceTick` drew its room rolls straight
   * from the orchestrator's SHARED per-user `rng` — so the move/room draws were part of the calibrated
   * spine, and every later shared-stream consumer (society/gossip/confessional/votes) saw a specific
   * sequence. To stay byte-identical to that spine, the BASE (un-weighted) assignment STILL draws from
   * the SHARED `rng`, with the exact same algorithm and draw count as before — so the shared stream is
   * advanced identically and the seeded competition/vote outcomes are byte-for-byte unchanged. (The
   * prior reverted attempt added EXTRA shared-stream draws for weighting; the first ship of this feature
   * over-corrected and drew NONE from the shared stream — both re-phased the spine and broke juryReach.)
   *
   * TWO assignments:
   *   • the BASE (un-weighted) occupancy — `presenceBase`, what `societyOccupancy()` feeds the society.
   *     Drawn from the SHARED `rng`, un-weighted, identical to the pre-L21/L24 build ⇒ INVARIANT to the
   *     personality constants AND byte-identical to the calibrated spine (proven by `movementStreamIsolation`
   *     + `juryReach`).
   *   • the personality-WEIGHTED occupancy — `presence`, the player-facing positions (`whereabouts`,
   *     witnessing). Drawn from a DEDICATED `movementRng()` stream (never the shared one), so however the
   *     weighting moves the house it cannot perturb calibration. The player never observes the hidden
   *     society's pairing, so one-place-at-a-time still holds for everything the player sees.
   */
  presenceTick(rng?: RandomnessSource): void {
    if (!this.house) return;
    // Advance the dedicated movement stream by one tick FIRST, so the WEIGHTED pass draws a fresh,
    // reproducible sub-stream (and a resumed game continues the deterministic sequence from the counter).
    this.presenceTickCount += 1;
    const me = this.house.player.id;
    const prev = this.presence;
    // The PLAYER's room is authoritative and IDENTICAL in both views — the player is never personality-
    // weighted (only NPCs are); they move only by their own `movePlayer`. So both passes pin the player at
    // the SAME real room; only NPC positions differ between the calibration-neutral base and the weighted view.
    const playerRoom = prev?.get(me) ?? null;
    // The base evolves from its OWN history (so it is INVARIANT to the personality constants — the society's
    // occupancy, and thus the seeded competition/vote outcomes, are byte-identical whether weighting is on
    // or off). Pre-L21/L24 saves have no separate base — seed it from the only positions we have.
    const prevBase = this.presenceBase ?? prev;

    // Compute one assignment for a given weighting. `weighted` ⇒ the DEDICATED movement stream (isolated
    // from calibration); un-weighted ⇒ the caller's SHARED `rng` (the calibrated spine the society reads),
    // falling back to the dedicated stream only when no shared rng is supplied (standalone/test callers).
    const assign = (previous: Occupancy | null, weighted: boolean): Map<EntityId, Room> => {
      const stream = weighted ? this.movementRng() : (rng ?? this.movementRng());
      if (!previous) {
        // Premiere seating — the ONE time everyone (the player included) is placed at once.
        return assignRooms(this.presenceActive(), null, this.presenceDeps(stream, weighted));
      }
      // L21/L24: the PLAYER is a person — the engine NEVER auto-relocates them. Pin them (in BOTH views) at
      // their real room; the engine drives only the NPCs around the held player.
      const pinned = playerRoom ? new Map<EntityId, Room>([[me, playerRoom]]) : null;
      return assignRooms(this.presenceActive().filter((id) => id !== me), previous, this.presenceDeps(stream, weighted), pinned);
    };

    // The BASE draws from the SHARED `rng` FIRST — the same single un-weighted `assignRooms` call (same
    // active set, same `prev`, same pinned player) the pre-L21/L24 build made, so the shared stream is
    // advanced byte-identically to the calibrated spine.
    const nextBase = assign(prevBase, false);   // calibration spine — the society's occupancy
    const next = assign(prev, true);            // personality-weighted — the player's positions
    // The player's position is authoritative and identical in both views (never personality-weighted) —
    // force the base to agree with the weighted player room so a player overhear of an off-screen scene
    // reads the player's REAL room, and the two views never disagree about where the player is.
    const realPlayerRoom = next.get(me);
    if (realPlayerRoom) nextBase.set(me, realPlayerRoom);

    // L21/L24: room tenure (player-facing) — a houseguest who held their room this tick keeps
    // accumulating; a mover resets to 0. Grounds scene continuity in `whereabouts`.
    const tenure = new Map<EntityId, number>();
    for (const [id, room] of next) {
      const stayed = prev?.get(id) === room;
      tenure.set(id, stayed ? (this.presenceTenure?.get(id) ?? 0) + 1 : 0);
    }
    this.presence = next;
    this.presenceBase = nextBase;
    this.presenceTenure = tenure;
  }

  /**
   * The player DIRECTS their own movement (L21/L24 — the player is a person, not engine-relocated):
   * walk to a room they NAMED. The name is resolved FORGIVINGLY (`resolveRoom`) — case/space/hyphen-
   * insensitive, natural aliases ("living room"/"lounge", "backyard"/"yard", "HOH", "pantry"), and a
   * bare "bedroom" disambiguated to the player's current/adjacent bedroom — so a guessed room never
   * silently no-ops into the narrator's 5-retry "isn't mapping" loop (the real-log bug). Sets the
   * player's room, resets their tenure; the engine holds them there (NPCs drive around them) until the
   * next directed move. For a truly UNKNOWN name it leaves the player put and returns the current
   * whereabouts unchanged (the model knows the valid rooms from the moment prompt, so this is rare).
   * Returns the resulting whereabouts so the caller can voice the move. Vault-free.
   */
  movePlayer(room: string): WhereaboutsView | null {
    if (!this.house || !this.presence) return null;
    const me = this.house.player.id;
    const here = this.presence.get(me) ?? null;
    // Forgiving resolution (Vault-free, deterministic): natural names → a canonical room id; the
    // player's current room sharpens an ambiguous "bedroom". An ambiguous result still moves (we take
    // the best-guess first candidate) rather than no-op — never a silent failure into a retry loop.
    const resolved = resolveRoom(room, here);
    const dest =
      resolved.kind === "ok" ? resolved.room
      : resolved.kind === "ambiguous" ? resolved.candidates[0]!
      : null;
    if (dest === null) return this.whereabouts(); // truly unknown — stay put, report where they are
    if (here === dest) return this.whereabouts(); // already there — nothing to move
    this.presence.set(me, dest);
    // L21/L24: the player's position is identical in both views — keep the calibration-neutral base in sync
    // so the society's player-overhears and `whereabouts` always agree about where the player is.
    this.presenceBase?.set(me, dest);
    (this.presenceTenure ??= new Map()).set(me, 0); // a fresh arrival
    this.persist();
    return this.whereabouts();
  }

  /**
   * The player-facing occupancy ground truth (engine/registry wiring — never projected raw to the player).
   * Carries the personality-WEIGHTED NPC positions (L21/L24) — what the player observes via `whereabouts`
   * and what witnessing a player scene reads.
   */
  occupancy(): Occupancy | null {
    return this.presence;
  }

  /**
   * The CALIBRATION-NEUTRAL occupancy the OFF-SCREEN SOCIETY pairs on (L21/L24). The society's co-present
   * pairing feeds relationship folds → (downstream) nominations/votes, so it must be INVARIANT to the
   * personality-movement constants — the base assignment is, which keeps the seeded competition/vote
   * outcomes byte-identical whether or not the weighting is enabled. Falls back to the weighted positions
   * for pre-L21/L24 saves (no base yet) or before the first tick.
   */
  societyOccupancy(): Occupancy | null {
    return this.presenceBase ?? this.presence;
  }

  /** Drop anyone presence still seats who is no longer active (the just-evicted are nowhere). */
  private prunePresence(): void {
    if (!this.presence) return;
    const active = new Set(this.presenceActive());
    for (const id of [...this.presence.keys()]) if (!active.has(id)) this.presence.delete(id);
    // L21/L24: prune the calibration-neutral base in lockstep so the society never pairs an evictee.
    if (this.presenceBase) for (const id of [...this.presenceBase.keys()]) if (!active.has(id)) this.presenceBase.delete(id);
    if (this.presenceTenure) for (const id of [...this.presenceTenure.keys()]) if (!active.has(id)) this.presenceTenure.delete(id);
  }

  whereabouts(): WhereaboutsView | null {
    if (!this.house || !this.presence) return null;
    const me = this.house.player.id;
    const room = this.presence.get(me);
    if (!room) return null; // the player is nowhere (out of the house)
    const inRoom = (r: Room): NamedRef[] => {
      const out: NamedRef[] = [];
      for (const [id, where] of this.presence!) {
        if (where === r && id !== me) out.push({ id, name: this.nameOf(id) });
      }
      return out;
    };
    // The player's room + each ADJACENT room only — what they could see or hear themselves.
    const present = inRoom(room);
    return {
      room,
      present,
      nearby: (HOUSE_ADJACENCY.get(room) ?? []).map((r) => ({ room: r, present: inRoom(r) })),
      // L21/L24: duration — the player's tenure in this room + each companion's, so the narrator
      // voices continuity (who has lingered with you vs. who just walked in) instead of resetting.
      turnsHere: this.presenceTenure?.get(me) ?? 0,
      companions: present.map((p) => ({ ...p, turnsHere: this.presenceTenure?.get(p.id) ?? 0 })),
    };
  }

  socialInitiatives(): SocialInitiative[] {
    if (!this.house) return [];
    // E89 (ruling #5): no approach fires before the house has actually started playing —
    // empty until the season's first ceremony beat (the week-1 HOH result) has resolved.
    // Structural engine gate; the FE's started-gate is only the belt.
    if (
      APPROACH_GATE.requireFirstCeremonyBeat &&
      (!this.live || !firstCeremonyBeatResolved(this.live))
    ) {
      return [];
    }
    const player = this.house.player.id;
    // B52/audit D5: an evicted houseguest can't pull you aside — only LIVING NPCs approach.
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const npcIds = this.house.npcs.filter((n) => !evicted.has(n.id)).map((n) => n.id);
    // Deterministic per moment (the temperature roll cannot flip a clear relationship gap, 0012),
    // so the same week/phase reproduces the same approaches. The hidden drive NUMBER is NOT
    // surfaced — only the name + the coarse motive category (E60: the fact the GM voices in its
    // own words, never a canned pretext line), so no trust/threat read leaks across the wall.
    const rng = new SeededRandom(hashSeed(`approaches:${this.gameSeed ?? ""}:${this.week}:${this.phase}`));
    return rankApproaches(player, npcIds, this.rel, rng).slice(0, 3).map((a) => ({
      houseguest: { id: a.npc, name: this.nameOf(a.npc) },
      motive: a.motive,
    }));
  }

  /** The player's current public standing — Vault-free (ceremony facts only). */
  private standing(): Standing {
    if (!this.house) return "pre-game";
    const me = this.house.player.id;
    if (this.ceremony.hoh === me) return "hoh";
    if (this.ceremony.nominees.includes(me)) return "nominee";
    if (this.ceremony.vetoHolder === me) return "veto-holder";
    return "houseguest";
  }

  playerTagline(): PlayerTaglineView {
    const standing = this.standing();
    const key = `${this.week}|${this.phase}|${standing}`;
    const cached = this.taglineCache.get(key);
    if (cached !== undefined) return { text: cached };

    // The curated, state-aware line is both the default and the fail-open fallback.
    let text = SNARKY_TAGLINES[standing];
    if (this.narrator) {
      try {
        const line = oneLine(this.narrator.narrate({
          forEntity: this.house?.player.id ?? PLAYER,
          mode: "scene",
          visibleEvents: [],
          knowledge: [],
          systemPrompt: `${TAGLINE_INSTRUCTION} Standing: ${standing}. Week ${this.week}, phase ${this.phase}.`,
        }));
        if (isUsableTagline(line)) text = line; // else fail open to the curated line
      } catch {
        /* narrator error/timeout ⇒ keep the curated themed line (never blank, never blocking) */
      }
    }
    this.taglineCache.set(key, text);
    return { text };
  }

  // ─── PREMIERE meet-everyone (feature #380 follow-on) — NEW BLOCK ─────────────────────────────────
  /**
   * Is the game in the premiere moment (move-in, before the first HOH)? The tracker is meaningful ONLY
   * here — once the first HOH begins (`phase` leaves "premiere") there is nothing left to meet, so the
   * read methods return `null` and the (now-vestigial) set is lazily cleared so it never lingers in the
   * persisted snapshot. Never reads `live`/the advance path — purely the public phase.
   */
  private inPremiere(): boolean {
    return this.house !== null && this.phase === "premiere";
  }

  /** Lazily clear a stale tracker once the premiere is over (keeps the snapshot clean; idempotent). */
  private clearPremiereIfOver(): void {
    if (!this.inPremiere() && this.premiereMet.size > 0) {
      this.premiereMet.clear();
      this.persist();
    }
  }

  /** The OBSERVABLE public read of one active houseguest (PUBLIC facets only — no Vault, no numbers). */
  private firstImpressionOf(n: GameHouse["npcs"][number]): FirstImpressionView {
    // Exactly the Vault-free facets the roster card already exposes (B61/L28): archetype, strategy
    // style, background, age, presentation, demeanor. NEVER the soul, hiddenElements, or a number.
    return {
      houseguest: { id: n.id, name: n.name },
      met: this.premiereMet.has(n.id),
      ...(n.character.archetype !== undefined ? { archetype: n.character.archetype } : {}),
      ...(n.character.strategyStyle !== undefined ? { strategyStyle: n.character.strategyStyle } : {}),
      ...(n.character.background !== undefined ? { background: n.character.background } : {}),
      ...(n.character.age !== undefined ? { age: n.character.age } : {}),
      ...(n.character.presentation !== undefined ? { presentation: n.character.presentation } : {}),
      ...(n.character.demeanor !== undefined ? { demeanor: n.character.demeanor } : {}),
    };
  }

  /**
   * The premiere's meet-everyone progress (feature #380 follow-on) — the engine-tracked, Vault-free
   * answer to "who's met, who's still to introduce?". Only ACTIVE NPCs count (the cast at move-in);
   * the player is implicitly met (counted in `metCount`/`total`), so `total` is the whole cast. The
   * narrator reads `remaining` to drive the next introduction; `complete` is the structural gate the
   * first HOH waits on. `null` outside the premiere.
   */
  premiereIntros(): PremiereIntrosView | null {
    this.clearPremiereIfOver();
    if (!this.house || !this.inPremiere()) return null;
    const activeNpcs = this.house.npcs.filter((n) => this.seatOf(n.id) === "active");
    const remaining: FirstImpressionView[] = [];
    const met: FirstImpressionView[] = [];
    for (const n of activeNpcs) {
      const fi = this.firstImpressionOf(n);
      (fi.met ? met : remaining).push(fi);
    }
    // +1 on both counts for the player (they ARE met — they're playing). total = the whole cast.
    return {
      complete: remaining.length === 0,
      metCount: met.length + 1,
      total: activeNpcs.length + 1,
      remaining,
      met,
    };
  }

  /**
   * Mark a houseguest as introduced/met during the premiere (feature #380 follow-on). The structural
   * tracker the producer drives so all 15 NPCs are met before the first HOH. Idempotent; a no-op for an
   * unknown houseguest, the player (auto-met), an evicted/departed seat, or once the premiere is over.
   * Persists (durable resume, 0030) and returns the resulting progress (or `null` outside the premiere).
   */
  markHouseguestMet(id: EntityId): PremiereIntrosView | null {
    this.clearPremiereIfOver();
    if (!this.house || !this.inPremiere()) return null;
    // Only a real, active NPC can be "met" — the player is implicitly met; an unknown/departed id is a no-op.
    const isActiveNpc = this.house.npcs.some((n) => n.id === id && this.seatOf(n.id) === "active");
    if (isActiveNpc && !this.premiereMet.has(id)) {
      this.premiereMet.add(id);
      this.persist();
    }
    return this.premiereIntros();
  }
  // ─────────────────────────────────────────────────────────────────────────────────────────────────

  createCharacter(req: CreateCharacterReq): GameStateView {
    // 0056 — "keep the existing character": on a CONFIRMED restart with `keepCharacter`, capture the
    // prior player's AUTHORED fields HERE (the only point the prior season still exists, before any
    // reset) and fold them under the explicit req. The static CHARACTER is seed-independent, so re-
    // supplying these regenerates the SAME houseguest in the new season; explicit fields still win,
    // so the player may tweak on the way through. No hidden number is read.
    const carried = (this.house && req.confirmRestart && req.keepCharacter) ? this.carryOverFields() : null;
    const effReq: CreateCharacterReq = carried ? { ...carried, ...req, keepCharacter: false } : req;
    // Non-degradation at its single most destructive point (B36/audit A2): an already-started game is
    // NEVER silently wiped. Without an explicit `confirmRestart`, a second createCharacter (a stray GM
    // call, a network caller) is a no-op returning the current state — the prior save is left intact.
    if (this.house) {
      // The no-op returns the PRIOR season's view — but now SIGNALS the refusal (audit R4-05) so the
      // caller can tell "created" from "left untouched". Without it the model read the unchanged view
      // as success and narrated a new season the engine never started.
      if (!req.confirmRestart) return { ...this.view(), createRefused: this.live?.finished ? "over" : "in-progress" };
      // A CONFIRMED restart routes through the ONE sanctioned door (audit E1/D1/R1): the registry's
      // reset delegate — the SAME hinge the admin reset uses — forgets the orchestrator baseline,
      // rotates the dead season's saves, and creates season 2 in a clean sandbox. Without that the
      // fresh week-1 snapshot read as a count regression against the finished season ⇒ a degradation
      // fault on every commit, nothing persisted, and the dead season resurrected on engine restart.
      if (this.onRestart) return this.onRestart({ ...effReq, confirmRestart: false });
      // Standalone (no registry composed — tests/onboarding fixtures): legacy in-place restart.
    }
    // Finalize FROM the interview's incremental intake (0050): everything updateCasting recorded
    // is the base; explicit args override field-by-field. OOBE can arrive half-done or fully done —
    // the one hard requirement is a name from SOMEWHERE.
    const merged = mergeCastingUpdate(this.intake, {
      ...effReq,
      ...(effReq.interviewNotes ? { interviewNotes: effReq.interviewNotes } : {}),
    });
    const playerName = merged.playerName;
    if (!playerName) {
      throw new EngineRefusal(
        "casting needs a name before the season can start — ask the player and record it with updateCasting",
      );
    }
    // E39/C7/D8: the DEFAULT seed is real entropy, persisted with the snapshot — the same player
    // name must never replay the byte-identical season (incl. its hidden elements and twist
    // schedule: a restarting player would replay secrets they already know). Explicit seeds stay
    // first-class for tests and replays.
    const seed = effReq.seed ?? entropySeed();
    this.gameSeed = seed; // B60/E12: every per-moment rng below keys off the GAME's seed
    // The producer persona (producer-persona feature): keep the producer the player has been interviewing
    // with if one was already established pre-game; otherwise bind it to the season seed so a direct
    // `createCharacter` (no prior interview, e.g. tests) still has a deterministic, reproducible producer.
    // Either way the off-camera producer is NEVER one of the 16 — it is not added to the house below.
    if (this.producerSeed === null) this.producerSeed = seed;
    this.producerCache = null;
    // 0051: draw ONE per-season portrait style anchor, seeded off the game seed — same seed always
    // draws the same anchor, so the house looks like itself across restarts and through the season.
    this.portraitStyleAnchor = STYLE_ANCHOR_VARIANTS[
      new SeededRandom(hashSeed(`${seed}:portrait-style`)).int(STYLE_ANCHOR_VARIANTS.length)
    ];
    // 0062 — capture the move-in zeitgeist snapshot ONCE, here, off the SAME season-seed hinge as the
    // cast, then FREEZE it (§3/§9). This is the deterministic `model-framed` fallback (the no-provider
    // path, §8) — reproducible-by-seed and byte-stable across every turn/restart; the FE may REPLACE it
    // with a real `web_search` capture via `recordWorldSnapshot` (FE-owned provider, like the 0051 image
    // port). It NEVER reaches the deterministic core — pure outward flavor (§6). `capturedFor` is the
    // in-fiction move-in marker; the snapshot freezes the house there for the whole season.
    this.worldSnapshot = buildWorldSnapshot({ seed, capturedFor: "move-in day" });
    const archetype = merged.archetype && isPlausibleArchetype(merged.archetype) ? merged.archetype : undefined;
    const strategyStyle = merged.strategyStyle as StrategyStyle | undefined;
    // Keep the player's RAW typed words as their public persona (narrative/display), even when they
    // don't match a canonical archetype/style — so the game master voices them as they described
    // themselves. The canonical `archetype`/`strategyStyle` above still drive hidden stats (0006).
    // The casting interview (0050) carries both halves: the canonical mapping in
    // `archetype`/`strategyStyle` and the player's OWN words in `personaArchetype`/`personaStrategyStyle`.
    this.house = startNewGame({
      seed, playerName, archetype, strategyStyle,
      ...(merged.personaArchetype ? { personaArchetype: merged.personaArchetype }
        : merged.archetype ? { personaArchetype: merged.archetype } : {}),
      ...(merged.personaStrategyStyle ? { personaStrategyStyle: merged.personaStrategyStyle }
        : merged.strategyStyle ? { personaStrategyStyle: merged.strategyStyle } : {}),
      ...(merged.backstory ? { backstory: merged.backstory } : {}),
      ...(merged.privateStrategy ? { privateStrategy: merged.privateStrategy } : {}),
      ...(merged.motivation ? { motivation: merged.motivation } : {}),
      ...(merged.interviewNotes.length ? { interviewNotes: merged.interviewNotes } : {}),
    });
    this.intake = emptyIntake(); // the interview is over — its material lives on the player now
    this.week = 1;
    this.phase = "premiere";
    // PREMIERE (feature #380 follow-on): start the meet-everyone tracker empty — nobody has been
    // introduced yet. The producer (driven by the premiere moment prompt's who's-left list) walks the
    // player through all 15 NPCs before the first HOH; `premiereMet` records who's been met. Persisted.
    this.premiereMet = new Set();
    // Start the incremental weekly loop over the live house (player + NPCs).
    this.live = newLiveSeason([this.house.player.id, ...this.house.npcs.map((n) => n.id)]);
    // 0025/B53 — load + SEAL the reserve twists: seeded, rare, at most one armed week each, only
    // kinds the live loop implements. Engine-only: the schedule rides in the loop state (persisted,
    // 0030) and the registry writes the Vault audit copy. Invisible to player AND admin until fired.
    const reserve = loadReserveTwists(this.twistCount, new SeededRandom(hashSeed(`${seed}:twists`)))
      .filter((t) => IMPLEMENTED_TWISTS.has(t.kind))
      .filter((t, i, all) => all.findIndex((o) => o.fireAtBeat === t.fireAtBeat) === i); // one twist per week
    if (reserve.length > 0) {
      this.live.reserve = reserve;
      this.onSeal?.(reserve);
    }
    // 0063 — the casting diversity floor: deal the engine-GUARANTEED diversity layer off a DEDICATED
    // isolated sub-stream (never the shared house/competition stream — the #338 RNG-isolation lesson),
    // validate/repair to the four floors (BIPOC / gender balance / age spread / LGBTQ+), fold the PUBLIC
    // facets (ethnicity, gender presentation, an out orientation) onto each byte-stable Character, GROUND
    // physicalCharacteristics.skinTone from the ethnicity, and SEAL each private orientation into the
    // Vault. Done BEFORE seedDeepProfiles so the deep layer's skin-tone reads the grounded ethnicity.
    this.seedDiversity(seed);
    // 0058 — born deep: generate the cast's deterministic DEEP layer (the seeded floor + offline
    // fallback), then SPLIT it across the Vault Wall. The PUBLIC facets (biography + the structured
    // physical characteristics) fold onto each byte-stable Character; the HIDDEN profile + the derived
    // story threads are sealed engine-side (into the Vault + the recall index) via `onSealProfiles`.
    // Done BEFORE seedFirstImpressions so the Day-1 perception can seed the NPC→player edge.
    this.seedDeepProfiles(seed);
    // Seed first impressions so NPC decisions are differentiated from move-in (without this,
    // empty relationships make every HOH nominate the same first-in-roster houseguests). These
    // are starting beliefs; the consequence fold (0023) evolves them as the player acts.
    this.seedFirstImpressions(seed);
    // 0059 — born with a few HIDDEN ties: seed the sparse pre-game ties + showmances (0–2 each, often
    // none), fold their small standing affinity bias on top of the move-in edges, and SEAL them into the
    // Vault (engine-only; invisible to player AND admin — they surface only organically). Done AFTER
    // first impressions so the bias rides the scattered baseline; persisted so a showmance never resets.
    this.seedSeededRelationships(seed);
    this.wireDispositions(); // archetype → disposition (B55): grudges stick, loyalists forgive
    // Move-in (0049): seat everyone somewhere (first assignment may place anyone anywhere). L21/L24:
    // seed BOTH views from the SAME premiere stream — the player-facing WEIGHTED positions (`presence`)
    // and the calibration-neutral BASE the off-screen society pairs on (`presenceBase`). The player's
    // room is forced identical in both (they are never personality-weighted).
    this.presence = assignRooms(
      this.presenceActive(), null,
      this.presenceDeps(new SeededRandom(hashSeed(`${seed}:presence`)), true),
    );
    this.presenceBase = assignRooms(
      this.presenceActive(), null,
      this.presenceDeps(new SeededRandom(hashSeed(`${seed}:presence`)), false),
    );
    const meId = this.house!.player.id;
    const pr = this.presence.get(meId);
    if (pr) this.presenceBase.set(meId, pr);
    this.persist(); // durable save (0030): a started game must survive a restart
    // 0051: attach the season-start portrait prompts — present ONLY on this response (the FE calls
    // the image API once at move-in and stores the results). Built from PUBLIC appearance facets
    // only (id/name/appearance/age/presentation) — never stats, soul, or hidden elements.
    return { ...this.view(), portraitPrompts: this.castPortraitPrompts() };
  }

  /**
   * 0056 — the prior player's AUTHORED, Vault-free fields: everything needed to recreate the SAME
   * static CHARACTER next season. The character is seed-independent (aptitudes = the authored
   * archetype's bias, appearance = hash of the authored name), so re-supplying these regenerates the
   * identical houseguest under a new cast. The dynamic SOUL is deliberately NOT carried — the new
   * season starts at move-in — but the ORIGINAL casting-interview material (motivation + notes) is
   * reconstructed from the seeded Soul memory so the new season's memory re-seeds identically. No
   * hidden number is read or returned.
   */
  private carryOverFields(): CreateCharacterReq {
    const p = this.house!.player;
    // The interview seeded Soul memory as "casting interview — <note>" entries (and one
    // "casting interview — why I came: <motivation>"); reconstruct the original notes, dropping the
    // motivation line (carried separately) and any non-casting memory accrued during the season.
    const PREFIX = "casting interview — ";
    const notes = (p.soul?.memory ?? [])
      .filter((m) => typeof m === "string" && m.startsWith(PREFIX) && !m.startsWith(`${PREFIX}why I came: `))
      .map((m) => m.slice(PREFIX.length));
    return {
      playerName: p.name,
      archetype: p.character.archetype,
      strategyStyle: p.character.strategyStyle,
      ...(p.persona?.archetype ? { personaArchetype: p.persona.archetype } : {}),
      ...(p.persona?.strategyStyle ? { personaStrategyStyle: p.persona.strategyStyle } : {}),
      ...(p.character.background ? { backstory: p.character.background } : {}),
      ...(p.privateStrategy ? { privateStrategy: p.privateStrategy } : {}),
      ...(p.motivation ? { motivation: p.motivation } : {}),
      ...(notes.length ? { interviewNotes: notes } : {}),
    };
  }

  /**
   * Build the Vault-free cast portrait prompts (0051) from the PUBLIC house facets — the same
   * fields the visible projection exports on the HouseguestCard. No stats, no soul, no hidden
   * elements ever reach `buildCastPortraitPrompts`.
   */
  private castPortraitPrompts(): PortraitPromptEntry[] {
    if (!this.house || !this.portraitStyleAnchor) return [];
    const everyone = [this.house.player, ...this.house.npcs];
    const publicCast = everyone.map((h) => ({
      id: h.id,
      name: h.name,
      appearance: h.character.appearance,
      age: h.character.age,
      presentation: h.character.presentation,
      // L29: the structured physical facet (0058) AUTHORS the face so it matches the person and never
      // drifts from the narration. PUBLIC by construction; falls back to the prose appearance if unseeded.
      ...(h.character.physicalCharacteristics !== undefined
        ? { physicalCharacteristics: h.character.physicalCharacteristics } : {}),
      // 0063: feed the PUBLIC diversity + personality facets — heritage, presentation, demeanor — so each
      // shot is visibly that unique person. A PRIVATE orientation is NOT a Character field, so it never
      // reaches here (the §5 Vault rule, enforced by construction + the portrait sentinel sweep).
      ...(h.character.ethnicity !== undefined ? { ethnicity: h.character.ethnicity } : {}),
      ...(h.character.genderPresentation !== undefined ? { genderPresentation: h.character.genderPresentation } : {}),
      ...(h.character.demeanor !== undefined ? { demeanor: h.character.demeanor } : {}),
    }));
    return buildCastPortraitPrompts(publicCast, this.portraitStyleAnchor);
  }

  /**
   * Record casting-interview answers as they land (0050). Any subset of fields, any number of
   * times pre-game; notes append, scalars overwrite. Persisted on every update so a half-done
   * interview survives a restart (0030). Once a season is running this is a no-op that returns
   * the (complete) status — a stray call can never disturb a live game.
   */
  updateCasting(req: UpdateCastingReq): CastingStatusView {
    // Season already running: casting is CLOSED. Refuse HONESTLY (audit R4-05) instead of the old
    // fake `ready:true` that recorded nothing yet looked like success — that silent success let the
    // model narrate a fresh casting interview post-season while the engine never started one. The
    // refusal names whether a season is live (`in-progress`) or already crowned (`over`).
    if (this.house) {
      return { known: {}, missing: [], next: null, ready: false, refused: this.live?.finished ? "over" : "in-progress" };
    }
    const before = this.intake;
    // C8: which already-captured scalars this update replaces — computed against the PRIOR intake,
    // surfaced so the producer confirms the change rather than silently clobbering an answer.
    const overwrote = overwrittenScalars(before, req);
    // R4-01: keys that are NOT casting fields (a recording filed under `name`/`notes`/a typo would
    // otherwise vanish). Echo them so the producer re-files rather than stalling on a lost answer.
    const ignoredKeys = ignoredCastingKeys(req);
    this.intake = mergeCastingUpdate(this.intake, req);
    if (JSON.stringify(before) !== JSON.stringify(this.intake)) {
      this.persist(); // a half-done interview is durable state (0030)
    }
    const status = castingStatusOf(this.intake, overwrote);
    if (ignoredKeys.length > 0) status.ignoredKeys = ignoredKeys;
    return status;
  }

  /**
   * Realistic move-in reads (B55/audit C5+C6). Day one nobody KNOWS anyone: signals start near the
   * relationship BASELINE with a small seeded scatter (not uniform noise), the threat read leans on
   * the target's PUBLIC archetype menace (a comp-beast looks dangerous across the kitchen counter —
   * never their hidden numbers), and confidence sits BELOW the knowledge threshold, so every
   * day-one read is a HUNCH the season then firms or breaks. Deterministic per game.
   */
  private seedFirstImpressions(seed: number): void {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    const rng = new SeededRandom(hashSeed(`${seed}:relationships`));
    const { baseline, MOVE_IN } = RELATIONSHIP_CONSTANTS;
    const scatter = (): number => (rng.next() - 0.5) * 2 * MOVE_IN.spread;
    for (const a of all) for (const b of all) {
      if (a.id === b.id) continue;
      const e = this.rel.edge(a.id, b.id);
      e.trust = clamp01(baseline.trust + scatter());
      e.affinity = clamp01(baseline.affinity + scatter());
      e.threat = clamp01(baseline.threat + MOVE_IN.threatWeight * archetypeMenace(b.character.archetype) + scatter());
      e.confidence = MOVE_IN.confidence;
    }
    // 0058 §3: the AUTHORED Day-1 perception seeds the NPC→player edge — each NPC walks in already
    // reading the player as something (warm ally / undecided / threat), not from a blank slate. The
    // signed leans nudge the (already-scattered) move-in edge; the player NEVER sees a number — only
    // the later behavior. Hidden by construction (the leans live in the Vault-only deep profile).
    for (const n of this.house?.npcs ?? []) {
      const p = this.deepProfiles[n.id]?.dayOnePerception;
      if (!p) continue;
      const e = this.rel.edge(n.id, PLAYER);
      e.trust = clamp01(e.trust + MOVE_IN.spread * p.trustLean);
      e.affinity = clamp01(e.affinity + MOVE_IN.spread * p.affinityLean);
      e.threat = clamp01(e.threat + MOVE_IN.spread * p.threatLean);
    }
  }

  /**
   * 0058 — born deep. Generate the cast's DETERMINISTIC deep layer (the seeded floor + offline
   * fallback the live LLM author is validated against, ledger L28b) and SPLIT it across the Vault:
   *   • PUBLIC facets (biography + the structured physical characteristics) fold onto each byte-stable
   *     Character — they cross to the player and are guarded byte-stable (0007/0031);
   *   • the HIDDEN profile (2–3 secrets, true goals, weakness, Day-1 perception) + the derived story
   *     threads are kept ENGINE-ONLY here and sealed into the Vault + the recall index via the hook.
   * Deterministic per seed and player-INDEPENDENT (the layer keys off the cast's seeded names, never
   * the player's profile — same seed ⇒ same deep cast regardless of who the player is, L28).
   */
  /**
   * 0063 — the casting diversity floor. Deal the engine-GUARANTEED diversity layer off a DEDICATED
   * isolated sub-stream (forked off the seed via `hashSeed` inside `generateDiversityLayer` — NEVER the
   * shared house/competition/vote stream, the #338 RNG-isolation lesson), validate/repair to the four
   * floors, SPLIT across the Vault:
   *   • PUBLIC facets (ethnicity, gender presentation, an OUT orientation) fold onto each byte-stable
   *     Character — they cross to the player and are superset-guarded (0007/0031); the ethnicity ALSO
   *     grounds `physicalCharacteristics.skinTone` (applied in seedDeepProfiles, which runs next), so the
   *     text and the portrait agree;
   *   • each PRIVATE orientation (closeted / not-yet-out) is kept engine-only here and sealed into the
   *     Vault — it surfaces to the player ONLY via a 0002 pathway, never on any projection.
   * Deterministic per seed and player-INDEPENDENT (the sub-stream keys off the seeded cast names). The
   * diversity attributes are DESCRIPTIVE ONLY — never a competition/vote/outcome input.
   */
  private seedDiversity(seed: number): void {
    if (!this.house) return;
    // TEST SEAM (the #338 RNG-isolation golden test): `ORWELL_DISABLE_DIVERSITY=1` skips the entire
    // diversity layer. Because the layer runs on a DEDICATED sub-stream and folds ONLY descriptive
    // fields (never a competition/vote input), the public OUTCOME stream must be byte-identical with it
    // on vs. off — the golden test proves exactly that. Never set in production (the deploy default is on).
    if (process.env.ORWELL_DISABLE_DIVERSITY === "1") return;
    const layer = generateDiversityLayer(seed, this.house.npcs);
    // PUBLIC fold — onto the static Character (byte-stable from here on; superset-guarded).
    for (const n of this.house.npcs) {
      const pub = layer.public[n.id];
      if (!pub) continue;
      n.character.ethnicity = pub.ethnicity;
      n.character.genderPresentation = pub.genderPresentation;
      if (pub.outOrientation !== undefined) n.character.outOrientation = pub.outOrientation;
      // The age-spread floor may have repaired the age into a short band (descriptive only — age is NOT a
      // competition/vote input, so this never perturbs the seeded outcome stream). Write it back so the
      // card, the ageLook (0058), and the portrait all agree with the guaranteed spread.
      n.character.age = pub.age;
      this.groundedSkinTones[n.id] = pub.skinTone;
      // If the structured physical facet already exists (e.g. on a re-run path), ground its skin tone
      // now; otherwise seedDeepProfiles applies the grounding when it builds the facet.
      if (n.character.physicalCharacteristics) n.character.physicalCharacteristics.skinTone = pub.skinTone;
    }
    // HIDDEN — engine-only, sealed off the player AND admin (a private orientation is a secret).
    this.privateOrientations = { ...layer.privateOrientations };
    // Full-fidelity recall + persistence (L27b): record each private orientation into the NPC's
    // AUTHORITATIVE soul memory (engine-only — never crosses) so it persists losslessly with the house,
    // counts toward non-degradation (0007), and re-indexes on restore. Also index NOW for same-session.
    for (const [id, orientation] of Object.entries(layer.privateOrientations)) {
      const note = privateOrientationToVaultContent(id as EntityId, orientation);
      const n = this.house.npcs.find((x) => x.id === id);
      n?.soul.memory.push(note);
      this.soul?.recordToSoul(id as EntityId, note);
    }
    // Seal the private orientations into the Vault (engine-only audit copy, the §5 wall).
    const entries = Object.entries(layer.privateOrientations).map(([id, orientation]) => ({ id: id as EntityId, orientation }));
    if (entries.length) this.onSealPrivateOrientations?.(entries);
  }

  private seedDeepProfiles(seed: number): void {
    if (!this.house) return;
    const layer = generateCastDeepLayer(seed, this.house.npcs);
    // PUBLIC fold — onto the static Character (byte-stable from here on; superset-guarded).
    for (const n of this.house.npcs) {
      const pub = layer.public[n.id];
      if (!pub) continue;
      n.character.biography = pub.biography;
      n.character.physicalCharacteristics = pub.physicalCharacteristics;
      // 0063: GROUND the skin tone from the houseguest's ethnicity identity facet, so the structured
      // physical characteristics (which drive BOTH the narration and the portrait, L29/L23) agree with
      // the heritage the cast was guaranteed — the text and the picture never contradict the identity.
      const grounded = this.groundedSkinTones[n.id];
      if (grounded) n.character.physicalCharacteristics.skinTone = grounded;
      // L29 single-source reconciliation (appearance/physicalCharacteristics consistency fix): the prose
      // `appearance` is the OLDER 0004 descriptor, generated from INDEPENDENT pools — it could contradict
      // the structured facet (different build/skin/hair/age-look). Re-derive it FROM the structured facet
      // (the SAME builder the portrait uses) so the persisted prose can never disagree with the source of
      // truth, and any pre-0058 fallback reader stays consistent. Done at generation, before the first
      // persist, so the static Character still round-trips byte-stable (0007).
      n.character.appearance = physicalFacetToAppearance(n.character.physicalCharacteristics);
    }
    // HIDDEN — engine-only, sealed off the player AND admin.
    this.deepProfiles = layer.hidden;
    this.storyThreads = layer.threads;
    // 0060 — a fresh season starts with no nomination history and an unspent surfacing cap.
    this.nominationWeeks = {};
    this.surfacedThreadCount = 0;
    // Full-fidelity recall (L27b): the authored hidden detail is recorded into each NPC's AUTHORITATIVE
    // soul memory (engine-only — soul memory never crosses the wall, B65) so it (a) persists losslessly
    // with the house, (b) is counted toward non-degradation (0007), and (c) is re-indexed on restore by
    // `rebuildSoulIndex` (which replays `soul.memory`) — so a detail established at cast time is
    // recall-able in full FOREVER, across restarts. Also indexed NOW for same-session recall.
    for (const n of this.house.npcs) {
      const profile = layer.hidden[n.id];
      if (!profile) continue;
      const note = deepProfileToVaultContent(n.id, profile);
      n.soul.memory.push(note);
      this.soul?.recordToSoul(n.id, note);
    }
    // Seal the HIDDEN profile + threads into the Vault (engine-only audit copy, the §8 wall).
    this.onSealProfiles?.(
      Object.entries(layer.hidden).map(([id, profile]) => ({ id: id as EntityId, profile })),
      layer.threads,
    );
  }

  /**
   * 0059 — seed the sparse HIDDEN relationship layer (pre-game ties + showmances) off a SIDE rng, fold
   * each pair's small standing affinity BIAS onto the (already-scattered) move-in edges, and SEAL the
   * layer into the Vault. Engine-only by construction (the bias is the ONLY observable — as later
   * behavior — and no tie/partner/stage is ever projected). Deterministic per seed + player-independent.
   */
  /**
   * 0063 (owner decision #3) — the orientation-aware showmance ELIGIBILITY predicate the 0059 seeder uses,
   * assembled from each NPC's PUBLIC gender presentation + their FULL orientation (the out facet on the
   * Character OR the engine-only private orientation). Engine-only by construction (it reads the private
   * map but never surfaces it). A QUEER showmance is a first-class plausible pairing; it never forces one.
   */
  private showmanceEligiblePredicate(): (a: EntityId, b: EntityId) => boolean {
    const identityOf = (id: EntityId): { orientation: Orientation; genderPresentation: GenderPresentation } | null => {
      const n = this.house?.npcs.find((x) => x.id === id);
      if (!n || !n.character.genderPresentation) return null;
      const orientation = (n.character.outOrientation as Orientation | undefined)
        ?? this.privateOrientations[id] ?? "straight";
      return { orientation, genderPresentation: n.character.genderPresentation };
    };
    return (a, b) => {
      const ia = identityOf(a); const ib = identityOf(b);
      if (!ia || !ib) return true; // unknown identity (pre-0063 cast) ⇒ no gating (back-compat)
      return showmancePlausible(ia, ib);
    };
  }

  private seedSeededRelationships(seed: number): void {
    if (!this.house) return;
    const rng = new SeededRandom(hashSeed(`${seed}:seeded-relationships`));
    this.seededRels = loadSeededRelationships(
      this.house.npcs, this.tieBudget, this.showmanceBudget, rng, this.showmanceEligiblePredicate());
    // Fold the small standing affinity bias between each seeded pair (both directions). NEVER a
    // deterministic advantage — just unconscious warmth a careful player reads only as behavior (§3).
    const bias = (a: EntityId, b: EntityId, amount: number): void => {
      this.rel.edge(a, b).affinity = clamp01(this.rel.edge(a, b).affinity + amount);
      this.rel.edge(b, a).affinity = clamp01(this.rel.edge(b, a).affinity + amount);
    };
    for (const t of this.seededRels.ties) bias(t.a, t.b, TIE_AFFINITY_BIAS);
    for (const s of this.seededRels.showmances) bias(s.a, s.b, SHOWMANCE_SPARK_BIAS);
    if (this.seededRels.ties.length || this.seededRels.showmances.length) {
      this.onSealSeededRels?.(this.seededRels);
    }
  }

  /**
   * 0059 / L40 — advance the seeded showmances by the pair's CURRENT mutual affinity (the off-screen
   * tick calls this after its scenes move the edges). A showmance climbs spark → bond → visible only as
   * the two genuinely grow close over weeks (never instant); it RESOLVES when one of the pair leaves.
   * Returns the pairs that JUST became `visible` — the PUBLIC moment the house notices — so the caller
   * can record a witnessed beat the player can see. Pre-`visible` stages stay Vault-sealed (no surface).
   */
  advanceShowmances(): Array<{ a: EntityId; b: EntityId; aName: string; bName: string }> {
    if (!this.house) return [];
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const nameOf = (id: EntityId): string => this.house!.npcs.find((n) => n.id === id)?.name ?? id;
    const surfaced: Array<{ a: EntityId; b: EntityId; aName: string; bName: string }> = [];
    for (const s of this.seededRels.showmances) {
      if (s.stage === "resolved") continue;
      if (evicted.has(s.a) || evicted.has(s.b)) { s.stage = "resolved"; continue; }
      const mutual = Math.min(this.rel.edge(s.a, s.b).affinity, this.rel.edge(s.b, s.a).affinity);
      const next = nextShowmanceStage(s.stage, mutual);
      if (next !== s.stage) {
        s.stage = next;
        if (next === "visible") {
          const sm = { a: s.a, b: s.b, aName: nameOf(s.a), bName: nameOf(s.b) };
          surfaced.push(sm);
          this.onShowmanceSurfaced?.(sm); // record the PUBLIC house beat (engine-only seam)
        }
      }
    }
    return surfaced;
  }

  /**
   * 0059 / L40 — the Vault-free projection of the PUBLIC showmances (stage `visible`): once a showmance
   * is visible the whole house knows it, so naming the pair is a public fact, not a Vault leak. This is
   * what lets the narrator voice romance for THESE pairs ONLY (the L40 restraint). Pre-visible (sealed)
   * showmances and the pre-game ties never appear here.
   */
  visibleShowmances(): Array<{ a: string; b: string }> {
    if (!this.house) return [];
    const nameOf = (id: EntityId): string => this.house!.npcs.find((n) => n.id === id)?.name ?? id;
    return this.seededRels.showmances
      .filter((s) => s.stage === "visible")
      .map((s) => ({ a: nameOf(s.a), b: nameOf(s.b) }));
  }

  /**
   * Activate ONE dormant story thread and FOLD its hidden weight (0058 §5) — reusing the 0023
   * consequence fold (`foldHiddenImpact`), NOT a parallel subsystem. The thread's source houseguest
   * acts toward the player (the witness/partner), moving the hidden relationship layer by the thread's
   * `weightImpact` interaction. Returns the activated thread (or undefined when none is dormant for
   * that source). The player sees only the later BEHAVIOR; no number, no premise ever crosses (§8).
   * This is the directly-callable activation+fold hook; the full automatic trigger/resolution scheduler
   * is LIVE in `scheduleStoryThreads` (feature 0060), wired into the off-screen tick — both share the
   * one `foldThreadActivation` step, zero drift.
   */
  activateThread(sourceId: EntityId, rng: RandomnessSource = new SeededRandom(hashSeed(`${this.gameSeed}:thread:${sourceId}`))): StoryThread | undefined {
    const thread = this.storyThreads.find((t) => t.sourceId === sourceId && t.status === "dormant");
    if (!thread) return undefined;
    this.foldThreadActivation(thread, rng);
    this.persist();
    return thread;
  }

  /** The shared activation step (0058 §5 / 0060 §4.1): flip dormant→active + fold the 0023 hidden weight.
   *  `activateThread` (the directly-callable hook) and the 0060 scheduler both go through here — one fold
   *  implementation, zero drift. NEVER persists itself (the scheduler batches one persist per tick). */
  private foldThreadActivation(thread: StoryThread, rng: RandomnessSource): void {
    thread.status = "active";
    thread.lifecycleWeek = this.week;
    // The source acts toward the player by the thread's nature — the hidden delta folds into the
    // relationship layer (engine-only). `toward: [PLAYER]` makes the player's read of the source move.
    foldHiddenImpact(this.rel, rng, thread.sourceId, [thread.sourceId, PLAYER], thread.weightImpact, [PLAYER]);
  }

  /**
   * Feature 0060 — the per-tick story-thread SCHEDULER. Rides the EXISTING bounded off-screen tick
   * (`orchestrator.defaultApply`), runs AFTER the tick's society/gossip/confessional steps so it reads
   * the freshly-moved house, and walks each thread's lifecycle once:
   *
   *   dormant  & triggerCondition met & roll < activateProb    → activate (reuse the 0023 fold, §4.1)
   *   active   & roll < surfaceProb & under the season cap      → surface (reuse 0038 gossip / 0002, §4.2)
   *   surfaced / active beyond resolveAfterWeeks                → resolve (one final 0023 fold, §4.3)
   *   source evicted / expireAfterWeeks elapsed dormant         → expire  (record, never delete, §4.4)
   *
   * It AUTHORS nothing and adds NO parallel subsystem — it only decides WHICH transition fires. Every
   * roll is a seeded SIDE rng (`seed:thread-scheduler:…`), so it never perturbs the main house stream
   * (0007 byte-stability) and the same seed + trigger sequence ⇒ the same thread drama (§4.5). Restraint
   * is structural: a hard season SURFACING cap (§5), at most one activation + one surface per tick, and
   * NPC↔NPC surfacing far more common than to-the-player. The Vault Wall holds (§7): nothing crosses but
   * a class-keyed paraphrase belief — never the premise, never a number.
   */
  scheduleStoryThreads(rng: RandomnessSource): void {
    if (!this.house || this.storyThreads.length === 0) return;
    this.recordNominationWeeks();
    const pos = this.seasonPosition();

    // Back-compat (§3): a thread restored from a pre-0060 save has no structured condition / lifecycle
    // week — default them in place (idempotent), so the predicate has a gate and the windows have a base.
    for (const t of this.storyThreads) {
      if (t.triggerCondition === undefined) t.triggerCondition = defaultTriggerConditionFor(t);
      if (t.lifecycleWeek === undefined) t.lifecycleWeek = this.week;
    }

    let activations = 0;
    let surfaces = 0;
    // Seed-stable iteration order is the derive order (the array order); never re-sort. The per-thread
    // side rng keys off the game seed + thread id + the live (week, phase) — so the roll is deterministic
    // AND advances as the game's POSITION advances (a thread gets a fresh chance each beat the house
    // moves to), never perturbing the main house stream (0007 §4.5). Within one (week, phase) repeated
    // ticks reuse the same roll — natural restraint: a thread fires at most once per beat, not per tick.
    for (const thread of this.storyThreads) {
      const side = new SeededRandom(hashSeed(`${this.gameSeed ?? ""}:thread-scheduler:${thread.id}:${this.week}:${this.phase}`));
      if (thread.status === "dormant") {
        // §4.4 — a dormant thread whose window has closed (source evicted, or expireAfterWeeks elapsed
        // since seed without ever triggering) EXPIRES: recorded, never deleted (non-degradation, §7).
        if (sourceWindowClosed(thread, pos)
          || this.week - (thread.lifecycleWeek ?? 0) >= THREAD.expireAfterWeeks) {
          thread.status = "expired";
          thread.lifecycleWeek = this.week;
          continue;
        }
        // §4.1 — ripe + a bounded roll + under the per-tick activation cap ⇒ activate (reuse 0023).
        if (activations < THREAD.maxActivationsPerTick
          && triggerMet(thread, pos)
          && side.next() < THREAD.activateProb) {
          this.foldThreadActivation(thread, side);
          activations++;
        }
        continue;
      }
      if (thread.status === "active") {
        // §4.3 — an active thread that has burned down (active longer than resolveAfterWeeks without
        // surfacing) RESOLVES off-screen with one final bounded 0023 fold; OR the source has left.
        if (sourceWindowClosed(thread, pos)
          || this.week - (thread.lifecycleWeek ?? 0) >= THREAD.resolveAfterWeeks) {
          this.foldThreadResolution(thread, side);
          continue;
        }
        // §4.2 / §5 — surface this tick (bounded roll, the season cap not yet spent, under the per-tick
        // surface cap). Surfacing is belief-level: NPC↔NPC gossip the common path, to-the-player rarer.
        if (surfaces < THREAD.maxSurfacesPerTick
          && this.surfacedThreadCount < THREAD.maxSurfacedPerSeason
          && side.next() < THREAD.surfaceProb) {
          this.surfaceThread(thread, pos, side);
          surfaces++;
        }
        continue;
      }
    }
    // No `persist()` here: the scheduler runs INSIDE the orchestrator's bounded off-screen tick, whose
    // own commit exports + persists the candidate snapshot (which includes the mutated `storyThreads`).
    // Persisting again would force a redundant O(events) re-serialization on the hot tick (R3/spineHardening).
  }

  /** §4.3 — resolve an active/surfaced thread: one FINAL bounded 0023 fold (the closing beat), then inert. */
  private foldThreadResolution(thread: StoryThread, rng: RandomnessSource): void {
    foldHiddenImpact(this.rel, rng, thread.sourceId, [thread.sourceId, PLAYER], thread.weightImpact, [PLAYER]);
    thread.status = "resolved";
    thread.lifecycleWeek = this.week;
  }

  /**
   * §4.2 — surface an active thread through an in-game pathway ONLY (never exposition). NPC↔NPC is the
   * common case (a vague class-keyed paraphrase handed to the 0038 gossip engine); surfacing TO the
   * player is rarer (gated behind `surfaceToPlayerProb` AND a real modeled pathway via the registry's
   * `surfaceInformationTo`, E9). Either way it counts ONCE against the hard season cap (§5). What
   * crosses is a belief with source + confidence — never the premise, never a number (§7).
   */
  private surfaceThread(thread: StoryThread, pos: SeasonPosition, rng: RandomnessSource): void {
    const name = this.nameOf(thread.sourceId);
    const rumor = threadRumor(thread, name);
    // Choose an NPC ORIGIN for the rumor: a living NPC other than the source (someone who'd whisper it).
    const livingNpcs = (this.house?.npcs ?? [])
      .map((n) => n.id)
      .filter((id) => id !== thread.sourceId && !pos.evicted.has(id));
    const toPlayer = rng.next() < THREAD.surfaceToPlayerProb && this.onThreadSurfaceToPlayer !== undefined;
    if (toPlayer && this.onThreadSurfaceToPlayer) {
      // Rare: a modeled pathway already reaches the player — surface a content-lineage-anchored belief
      // (E9). An unanchored attempt is correctly downgraded to a suspicion by 0002; either way the
      // thread is spent (it "surfaced" — the house's drama broke into the open).
      this.onThreadSurfaceToPlayer(thread.sourceId, rumor);
    } else if (livingNpcs.length > 0 && this.onThreadGossip) {
      // The common case: hand the paraphrase to the 0038 gossip engine to diffuse NPC↔NPC.
      const origin = livingNpcs[rng.int(livingNpcs.length)]!;
      this.onThreadGossip(origin, rumor, thread.sourceId);
    }
    thread.status = "surfaced";
    thread.lifecycleWeek = this.week;
    this.surfacedThreadCount++;
  }

  /** 0060 §3 (`nominated-twice`) — accrue the DISTINCT weeks each current nominee has been on the block. */
  private recordNominationWeeks(): void {
    for (const id of this.ceremony.nominees) {
      const weeks = (this.nominationWeeks[id] ??= []);
      if (!weeks.includes(this.week)) weeks.push(this.week);
    }
  }

  /**
   * Build the Vault-FREE season position the scheduler's predicates read (0060 §3). Every field is a
   * PUBLIC/engine-internal POSITION fact — never a thread premise. `cornered` is the bottom-quantile of
   * the living house by the engine's own bond read toward the player-side house (engine-internal, never
   * surfaced); `nominatedRepeatedly` reads the hidden nomination-week ledger above.
   */
  private seasonPosition(): SeasonPosition {
    const evicted = new Set(this.live?.evictionOrder ?? []);
    const livingNpcs = (this.house?.npcs ?? []).map((n) => n.id).filter((id) => !evicted.has(id));
    const livingCount = livingNpcs.length + (this.house && !evicted.has(this.house.player.id) ? 1 : 0);
    const powerHolders = new Set<EntityId>();
    if (this.ceremony.hoh) powerHolders.add(this.ceremony.hoh);
    if (this.ceremony.vetoHolder) powerHolders.add(this.ceremony.vetoHolder);
    // `cornered-socially`: a source's standing among the living house. Score each living NPC by how the
    // REST of the living house reads them (mean bondStrength of others' edges toward them); the bottom
    // quantile is "cornered". Pure engine read — never crosses the wall.
    const others = [...livingNpcs, ...(this.house ? [this.house.player.id] : [])];
    const standing = new Map<EntityId, number>();
    for (const id of livingNpcs) {
      let sum = 0; let n = 0;
      for (const o of others) {
        if (o === id) continue;
        const e = this.rel.edge(o, id);
        sum += e.trust + e.affinity - e.threat; n++;
      }
      standing.set(id, n > 0 ? sum / n : 0);
    }
    const ranked = [...standing.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const cut = Math.max(1, Math.floor(ranked.length * THREAD.corneredBottomQuantile));
    const cornered = new Set(ranked.slice(0, cut));
    const nominatedRepeatedly = new Set<EntityId>(
      Object.entries(this.nominationWeeks)
        .filter(([, weeks]) => weeks.length >= THREAD.nominatedWeeksForRivalry)
        .map(([id]) => id as EntityId),
    );
    return {
      week: this.week,
      livingCount,
      nominees: new Set(this.ceremony.nominees),
      powerHolders,
      cornered,
      nominatedRepeatedly,
      evicted,
    };
  }

  /**
   * Wire each houseguest's relationship DISPOSITION from their public archetype (B55/audit C5): a
   * villain holds grudges (clash, sticky), a loyalist forgives (bond). Derived from the persisted
   * static Character, so a restore re-derives it — no extra serialization needed.
   */
  private wireDispositions(): void {
    if (!this.house) return;
    for (const hg of [this.house.player, ...this.house.npcs]) {
      this.rel.setDisposition(hg.id, dispositionOf(hg.character.archetype));
    }
  }

  // --- Live weekly loop (0011) ---------------------------------------------------

  /** Build the Vault-free season context the pure loop reads (stats + live relationships + mood). */
  private ctx(): SeasonCtx {
    return {
      player: PLAYER,
      statsOf: (id) => this.statsOf(id),
      rel: this.rel,
      // The LIVE soul emotional state (0041) feeds the competition modifier + the rattled-HOH read.
      emotionalOf: (id) => this.soulObj(id)?.emotionalState ?? 0.5,
      // Derived loyalty (0043): disposition (static CHARACTER) × current soul state — feeds the
      // emergent bloc term. Derived per read; never stored (decision 0002).
      loyaltyOf: (id) => {
        const hg = this.house
          ? (this.house.player.id === id ? this.house.player : this.house.npcs.find((n) => n.id === id))
          : undefined;
        if (!hg) return 0.55;
        return derivedLoyalty(dispositionOf(hg.character.archetype), hg.soul.emotionalState);
      },
      // Static disposition (0044): gates which nomination tactic an HOH plays (pawn/backdoor/direct).
      dispositionOf: (id) => {
        const hg = this.house
          ? (this.house.player.id === id ? this.house.player : this.house.npcs.find((n) => n.id === id))
          : undefined;
        return hg ? dispositionOf(hg.character.archetype) : "neutral";
      },
      // Open deals binding the houseguest (0039 → 0044): the vote leans to honor; the ledger still
      // reconciles a break with its full betrayal consequence downstream.
      dealsOf: (id) => this.deals.open().filter((d) => d.condition.promisors.includes(id)),
    };
  }

  private statsOf(id: EntityId): Stats {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    return all.find((h) => h.id === id)?.character.stats ?? { physical: 0.5, mental: 0.5, social: 0.5 };
  }

  /** The houseguest's dynamic soul (player or NPC), or undefined when no game is live. */
  private soulObj(id: EntityId): Soul | undefined {
    if (!this.house) return undefined;
    if (this.house.player.id === id) return this.house.player.soul;
    return this.house.npcs.find((n) => n.id === id)?.soul;
  }

  /**
   * Fold a consequential moment into a houseguest's hidden soul (0041): evolve their emotional state
   * (bounded, mean-reverting — 0028 family) and deepen the recall-able arc (`recordToSoul`, 0024).
   * The static CHARACTER is never touched; only the SOUL drifts (0007). Hidden — never surfaced.
   * Audit E52: the swing carries ADR 0001's bounded per-moment temperature roll on a SIDE rng
   * (keyed off the game seed + the soul's own arc position — deterministic, restart-stable, and
   * the main beat stream is untouched).
   */
  private inflect(id: EntityId, event: EmotionalEvent): void {
    const soul = this.soulObj(id);
    if (!soul) return;
    const rng = new SeededRandom(hashSeed(
      `${this.gameSeed ?? this.house?.player.name ?? "season"}:arc:${id}:${event}:${soul.emotionalHistory.length}`,
    ));
    evolveEmotion(soul, event, undefined, rng);
    const note = arcNote(event, this.week);
    soul.memory.push(note);                 // persisted arc (house snapshot, monotonic — 0007/0030)
    this.soul?.recordToSoul(id, note);       // vector recall index (0024), when wired into the sandbox
  }

  /**
   * L27b — DURABLY record a recorded player-witnessed scene's summary into a houseguest's recall
   * memory. The fix this closes: `recordInteraction` (the player channel's social-scene seam) used to
   * index the summary into the SoulStore's vector index ALONE — which is DERIVED state. After a restart
   * `rebuildSoulIndex` replays only each houseguest's PERSISTED `soul.memory` mirror, so a scene's
   * semantic recall silently vanished on restart (the event record survived, but the NPC could no
   * longer RECALL the scene — a non-degradation #4 / L27b leak). Writing the SAME persisted mirror the
   * arc/confessional/deep-profile paths already use makes the scene recall-able IN FULL forever, across
   * restarts. Idempotent against the mirror: a content already present (e.g. a double restore replay) is
   * not duplicated, so the monotonic-count non-degradation guard stays exact.
   */
  recordSceneMemory(id: EntityId, content: string): void {
    const soul = this.soulObj(id);
    if (soul && !soul.memory.includes(content)) {
      soul.memory.push(content);            // persisted mirror — survives + re-indexes on restore (0030)
    }
    this.soul?.recordToSoul(id, content);    // vector recall index NOW (0024), same-session recall
  }

  /**
   * Evolve the involved souls from a just-resolved beat (the live consequence fold, 0041): a comp
   * winner is emboldened and the CONTESTED LOSERS are stung (audit E51 — `comp-loss` finally
   * fires); on an eviction the SURVIVING nominee is emboldened (`survived-vote`, the 0041 beat
   * that never fired) and the evictee's closest surviving ally is blindsided toward distress.
   * Drives the live emotional arc that then modulates later competitions + decisions.
   */
  private evolveFromBeat(ev: BeatEvent): void {
    if (!this.house) return;
    const s = this.live;
    switch (ev.beat) {
      case "hoh-competition": {
        const winner = ev.participants[0];
        if (winner) this.inflect(winner, "comp-win");
        // E51 (`comp-loss`): a loss stings where it was genuinely CONTESTED — the final-3 HOH
        // crown, where each loser just watched their endgame narrow. Losing a 13-player
        // mid-season HOH comp is background noise (folding it for the whole house weekly would
        // also drown every soul's recall in identical filler — the C12/E55 lesson).
        if (winner && s && s.active.length === 3) {
          for (const h of s.active) if (h !== winner) this.inflect(h, "comp-loss");
        }
        break;
      }
      case "nominations": {
        // B51: going on the block rattles a houseguest — distress ▲ — so they carry it INTO the veto
        // comp (their odds dip below their calm baseline). The Luck-replacement modifier, finally live.
        for (const nom of s?.nominees ?? []) this.inflect(nom, "nominated");
        break;
      }
      case "veto-competition": {
        const holder = s?.vetoHolder;
        if (holder) this.inflect(holder, "comp-win");
        // E51: the rest of the six-player field contested and lost (the participants ARE the field).
        for (const h of ev.participants) if (h !== holder) this.inflect(h, "comp-loss");
        break;
      }
      case "veto-ceremony": {
        // A replacement nominee is newly on the block — same rattle (they don't play the veto, but the
        // arc is honest). The original saved nominee's relief isn't modeled here (kept minimal).
        if (s?.replacement) this.inflect(s.replacement, "nominated");
        break;
      }
      case "eviction": {
        const evictee = ev.participants[0];
        if (!evictee) break;
        this.blindsideClosestAlly(evictee);
        // E51: the nominee who sat on the block and SURVIVED is emboldened — the 0041 arc beat.
        const survivor = s?.eviction?.nominees.find((n) => n !== evictee);
        if (survivor) this.inflect(survivor, "survived-vote");
        break;
      }
    }
  }

  /** Only a genuine ally (trust above this floor) is blindsided by an eviction — else it was expected. */
  private static readonly ALLY_TRUST_FLOOR = 0.5;

  /** The evictee's most-trusting surviving ally reads the eviction as a blindside (distress ▲, volatility ▲). */
  private blindsideClosestAlly(evictee: EntityId): void {
    const s = this.live;
    if (!s) return;
    let ally: EntityId | undefined;
    let best = GameSessionAdapter.ALLY_TRUST_FLOOR;
    for (const h of s.active) {            // s.active already excludes the just-removed evictee
      if (h === evictee) continue;
      const trust = this.rel.edge(h, evictee).trust;
      if (trust > best) { best = trust; ally = h; }
    }
    if (ally) this.inflect(ally, "blindside");
  }

  /** Deepen a houseguest's soul from an off-screen scene (0038/0041): the house lives between turns.
   *  Role-correct per audit E50: the INITIATOR of a betrayal is scheming, not wounded. */
  recordOffscreenSoul(npc: EntityId, type: InteractionType): void {
    this.inflect(npc, offscreenEmotion(type, "initiator"));
  }

  /**
   * Deepen BOTH participants of an off-screen scene, per role (audit E50): the betrayal victim's
   * soul finally moves (`betrayed`) while the betrayer schemes. The full-scene sibling of
   * `recordOffscreenSoul` — the off-screen tick should prefer this seam.
   */
  recordOffscreenScene(initiator: EntityId, partner: EntityId, type: InteractionType): void {
    this.inflect(initiator, offscreenEmotion(type, "initiator"));
    this.inflect(partner, offscreenEmotion(type, "partner"));
  }

  /** The manner-scale of an eviction fold (audit E48): full shock only for a genuine grievance. */
  private static mannerScale(m: EvictionManner): number {
    if (m.betrayed) return EVICTION_MANNER_SCALE.betrayed;
    if (m.blindsided) return EVICTION_MANNER_SCALE.blindsided;
    if (m.disrespected) return EVICTION_MANNER_SCALE.disrespected;
    return EVICTION_MANNER_SCALE.respected;
  }

  /**
   * Fold the hidden relationship consequence of a resolved ceremony beat (B38/audit C1 — the 0023
   * backbone that the live loop bypassed). Engine-owned, directed, magnitudes from `CEREMONY_IMPACTS`
   * (constants only). The change lives in the hidden layer — the player feels it later as behavior,
   * never as a number (0001). Runs on every ceremony (player- AND NPC-driven).
   *
   * Audit reworks: a comp win moves only the THREAT read (E47 — the house keeps liking its
   * winner); the eviction fold scales by the evictee's RECORDED manner (E48 — a respected,
   * expected eviction is not a betrayal); and the survivors' "proven threat" read lands on THIS
   * week's HOH (E49 — the old code read `outgoingHoh` before the rollover, hitting last week's).
   */
  private foldCeremonyConsequence(ev: BeatEvent): void {
    const s = this.live;
    if (!s) return;
    const rng = this.beatRng();
    const fold = (from: EntityId, to: EntityId, act: CeremonyAct, scale = 1): void => {
      if (from === to) return;
      const impact = scale === 1 ? CEREMONY_IMPACTS[act] : scaleImpact(CEREMONY_IMPACTS[act], scale);
      this.rel.applyImpactDirected(from, to, impact, rng);
    };
    switch (ev.beat) {
      case "hoh-competition": {
        const winner = ev.participants[0]; // the new HOH reads as a threat to the whole house (E47)
        if (winner) for (const h of s.active) fold(h, winner, "comp-won");
        break;
      }
      case "veto-competition": {
        const winner = s.vetoHolder;
        if (winner) for (const h of s.active) fold(h, winner, "comp-won");
        break;
      }
      case "nominations": {
        if (s.hoh && s.nominees) for (const nom of s.nominees) fold(nom, s.hoh, "nominated");
        break;
      }
      case "veto-ceremony": {
        if (s.saved && s.vetoHolder) fold(s.saved, s.vetoHolder, "veto-saved"); // gratitude bond + E54 evidence
        if (s.replacement && s.hoh) fold(s.replacement, s.hoh, "replaced");     // betrayal-shock if trusted
        break;
      }
      case "eviction": {
        const evictee = ev.participants[0];
        if (!evictee) break;
        // The evictee resents everyone responsible for sending them out (HOH + the voters who voted
        // to evict) — the SAME set the jury manner read captured — scaled by HOW it landed (E48):
        // a betrayal burns; a clean, expected move from a known rival leaves a fraction.
        const manner = s.mannerByEvictee?.[evictee] ?? {};
        for (const r of Object.keys(manner) as EntityId[]) {
          fold(evictee, r, "evicted", GameSessionAdapter.mannerScale(manner[r]!));
        }
        // The survivors read THIS week's HOH as a proven threat — they just ran the week (E49;
        // `rollWeek` has not run yet at this beat, so `s.hoh` is the reign that ends tonight).
        if (s.hoh) for (const h of s.active) fold(h, s.hoh, "comp-won");
        break;
      }
      case "self-eviction": {
        // 0061 §4.4: the present house's souls fold the player's VOLUNTARY walk-out — the house's
        // read of the LEAVER moves (threat▼ as a rival removes itself, a slight warmth/reliability
        // dip for quitting on them). The leaver is gone, so only the house→leaver direction folds.
        // `applySelfEviction` already removed the player, so `s.active` is exactly the present house.
        const leaver = ev.participants[0];
        if (leaver) for (const h of s.active) fold(h, leaver, "self-evicted");
        break;
      }
    }
  }

  /** A deterministic per-(week,beat) RNG so a given moment resolves the same way (and across restart). */
  private beatRng(): SeededRandom {
    // B60/audit E12: key off the GAME's seed (persisted), not the player's display name — two
    // same-named games get distinct streams; a restored game keeps its own. Legacy saves (no seed)
    // fall back to the old name key so their in-flight moments still resolve identically.
    const name = this.house?.player.name ?? "season";
    const root = this.gameSeed ?? name;
    // A double-eviction night (0025/B53) repeats the week's beats in its compressed second cycle —
    // disambiguate so the second HOH comp / eviction don't replay the first cycle's rolls.
    const cycle = this.live?.twist?.phase === "running" ? ":2" : "";
    return new SeededRandom(hashSeed(`${root}:${this.live?.week}:${this.live?.beat}${cycle}`));
  }

  advanceGame(): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    // One persisted commit per beat (E3): interior persists (a deal broken mid-tally) defer to a
    // single hook call AFTER all state mutation — a refused commit throws instead of narrating.
    return this.inOneCommit(() => {
      let ev: BeatEvent | null = null;
      if (!this.live!.pending && !this.live!.finished) {
        ev = advanceBeat(this.live!, this.ctx(), this.beatRng());
        this.commit(ev);
      }
      // Surface the just-resolved beat (it is player-witnessed) so the finale reveal/result beats
      // and every ceremony beat are visible in the view, not only recorded to the event store.
      return this.advanceView(ev);
    });
  }

  submitDecision(req: SubmitDecisionReq): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    // 0061 — self-eviction is the sanctioned CONFIRMED quit. It rides the SAME `submitDecision`
    // seam but resolves through its own dedicated path (NOT the ceremony-pending machinery): the
    // confirmation must already be raised (the OOC step-1 gate), AND `confirmed` must be true.
    // Anything else (a missing confirmation, confirmed:false/absent) is a safe no-op — the player
    // stays ACTIVE (the anti-accident handshake; never a fabricated exit, §4.2).
    if (req.kind === "self-evict") return this.resolveSelfEviction(req.confirmed === true);
    // No-op unless there's a matching pending decision to resolve (idempotent + robust
    // to malformed calls — the boundary must never throw an unhandled error).
    if (!this.live.pending || this.live.pending.kind !== req.kind) return this.advanceView(null);
    // (E42) Eviction-vote reconciliation moved to `commit`: the staged eviction's `voteOf` carries
    // EVERY voter — player and NPC alike — so the ledger now sees all binding votes in one place.
    return this.inOneCommit(() => {
      // The beat-deterministic rng lets the Houseguest's-Choice resume run the veto comp reproducibly (B45).
      const ev = applyDecision(this.live!, this.toDecisionInput(req), this.ctx(), this.beatRng());
      this.commit(ev);
      return this.advanceView(ev);
    });
  }

  /**
   * Self-eviction step 1 (0061 §4.2) — an OOC intent-to-leave raises the confirmation pending and
   * changes NO game state (the house never hears it; the L36/L39a gate holds for the bare line). It
   * does NOT evict — only a confirmed `submitDecision({ kind: "self-evict", confirmed: true })` does.
   */
  requestSelfEviction(): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    if (this.live.finished || playerHasLeft(this.live, PLAYER)) return this.advanceView(null);
    return this.inOneCommit(() => {
      requestSelfEvict(this.live!, this.ctx());
      this.persist(); // durable: a raised confirmation survives a reload (0030)
      return this.advanceView(null);
    });
  }

  /** Self-eviction cancel (0061 §4.2) — clear the confirmation; the player plays on, ACTIVE, unchanged. */
  cancelSelfEviction(): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    return this.inOneCommit(() => {
      cancelSelfEvict(this.live!);
      this.persist();
      return this.advanceView(null);
    });
  }

  /**
   * Self-eviction step 2 (0061 §4.1) — the confirmed walk-out. A no-op unless the confirmation was
   * raised AND `confirmed` is true (the anti-accident gate; a stray/unconfirmed call never evicts).
   * Routes the exit through the SAME commit path every beat uses: `applySelfEviction` records a real
   * `self-eviction` BeatEvent (the registry records it player-witnessed + non-hidden), `commit` folds
   * its 0023 hidden impact, the player's status flips via the 0046 `evictionOrder` door, and the
   * snapshot persists. Never narrated-but-not-recorded: either this transition ran, or the player
   * is still in the house.
   */
  private resolveSelfEviction(confirmed: boolean): AdvanceView {
    const s = this.live!;
    // The gate: the OOC confirmation must be standing, the player must still be in, and the confirm
    // must be explicit. Any miss is a safe no-op (the player stays active) — never a fabricated exit.
    if (!confirmed || !s.selfEvictPending || s.finished || playerHasLeft(s, PLAYER)) {
      return this.advanceView(null);
    }
    return this.inOneCommit(() => {
      const ev = applySelfEviction(s, this.ctx());
      this.commit(ev); // record (witness = present house, non-hidden) + fold 0023 + sync + persist
      return this.advanceView(ev);
    });
  }

  /**
   * The player makes a deal with a houseguest (0039). Recorded as a player-witnessed event (their
   * knowledge); the engine reconciles it against later binding actions. Player↔NPC only — NPC↔NPC
   * deals are made off-screen and held in the Vault (never crosses this outward seam).
   */
  makeDeal(req: MakeDealReq): DealView | null {
    if (!this.house || !this.live) return null;
    const target = req.with;
    const evicted = new Set(this.live.evictionOrder);
    const isActiveOther = target !== PLAYER
      && this.house.npcs.some((n) => n.id === target) && !evicted.has(target);
    if (!isActiveOther) return null;
    const terms = (req.terms ?? "").slice(0, 200);
    const evId = this.onPlayerEvent?.(
      `${this.nameOf(PLAYER)} and ${this.nameOf(target)} make a ${req.kind} deal: ${terms}`,
      [PLAYER, target], "deal",
    );
    // `madeWeek` (E43) anchors the horizon: a safety/vote promise binds through THIS week's eviction.
    const deal = this.deals.make([PLAYER, target], req.kind, terms, evId, this.live.week);
    this.persist();
    return this.dealView(deal);
  }

  /** Reconcile a binding action against open player-party deals: kept/broken + the fallout (0039). */
  private reconcileDeals(action: BindingAction): void {
    if (!this.live) return;
    const { broken } = this.deals.reconcile(action, {
      rel: this.rel,
      rng: this.beatRng(),
      // 0014: the wronged party will weigh this betrayal against the breaker in their jury lean.
      juryDemerit: (wronged, breaker) => recordDealBetrayal(this.live!, wronged, breaker),
      // 0002: the wronged party learns the break as a witnessed event (a public ceremony break).
      reveal: (wronged, breaker, deal) => this.onPlayerEvent?.(
        `${this.nameOf(breaker)} broke a ${deal.kind} deal with ${this.nameOf(wronged)}`,
        [wronged, breaker], "betrayal",
      ),
    });
    if (broken.length > 0) this.persist(); // deferred into the beat's ONE commit (E3)
  }

  /**
   * EVERY binding action a resolved beat represents (audit E42 — the ledger must see NPC binding
   * actions, not only the player's). An eviction beat yields one `vote-evict` per voter (player
   * and NPC alike, from the staged reveal's `voteOf`) plus the HOH's deciding vote on a tie; the
   * Final-3 eviction is the final HOH's personal vote. `alternatives` (E43) scope honoring to
   * actions where the partner was a real option.
   */
  private bindingActionsFor(ev: BeatEvent): BindingAction[] {
    const s = this.live;
    if (!s) return [];
    switch (ev.beat) {
      case "nominations":
        return s.hoh && s.nominees
          ? [{
              actor: s.hoh, kind: "nominate", targets: [...s.nominees],
              alternatives: s.active.filter((h) => h !== s.hoh),
            }]
          : [];
      case "veto-ceremony":
        return s.hoh && s.replacement ? [{ actor: s.hoh, kind: "replace", targets: [s.replacement] }] : [];
      case "eviction": {
        const e = s.eviction;
        const evictee = ev.participants[0];
        if (!e || !evictee) return [];
        const actions: BindingAction[] = Object.entries(e.voteOf).map(([voter, votedFor]) => ({
          actor: voter as EntityId, kind: "vote-evict", targets: [votedFor], alternatives: e.nominees,
        }));
        // A tied reveal means the HOH cast the deciding vote (player OR NPC) — that is binding too.
        const votes = Object.values(e.voteOf);
        const tied = votes.filter((v) => v === e.nominees[0]).length === votes.filter((v) => v === e.nominees[1]).length;
        if (tied && s.hoh) {
          actions.push({ actor: s.hoh, kind: "vote-evict", targets: [evictee], alternatives: e.nominees });
        }
        return actions;
      }
      case "final-eviction": {
        // Final 3 (0045): the final HOH personally evicts — participants = [hoh, evictee]; the
        // survivor (now in the Final 2 with them) was the alternative they spared.
        const [actor, evictee] = ev.participants;
        if (!actor || !evictee) return [];
        const survivor = s.active.find((h) => h !== actor);
        return [{
          actor, kind: "vote-evict", targets: [evictee],
          alternatives: survivor ? [evictee, survivor] : [evictee],
        }];
      }
      default:
        return [];
    }
  }

  /** Fold a resolved beat into the public projection: record the event, reconcile deals, sync, persist. */
  private commit(ev: BeatEvent | null): void {
    if (ev) this.onEvent?.({ ...ev, content: this.humanize(ev.content) });
    // 0039/E42: a binding ceremony beat may honor or break open deals — the engine adjudicates
    // EVERY binding actor's action (NPC votes and tie-breaks included), never only the player's.
    if (ev) for (const action of this.bindingActionsFor(ev)) this.reconcileDeals(action);
    // 0040/E55: at the week's dramatic beats the directly-involved houseguests privately confess
    // their REAL engine-grounded read — Vault-only (witnessed by them alone), reaching no one.
    if (ev) this.recordCeremonyConfessionals(ev);
    // E46: as the block goes up, the tightest unbound NPC pair may seal a hidden pact of their own.
    if (ev && ev.beat === "nominations") this.mintNpcDeal();
    // 0041: the season changes a houseguest — fold the beat's emotional impact into the involved souls
    // (a comp win emboldens; a blindside rattles), evolving the hidden arc that bends their later play.
    if (ev) this.evolveFromBeat(ev);
    // B38/0023: the loop's most consequential acts (noms/veto/replacement/eviction/comp wins) move the
    // HIDDEN relationship layer — the player's action changes how the house feels about them (and each
    // other). Engine-owned, magnitudes from constants, never surfaced (the Vault Wall, 0001).
    if (ev) this.foldCeremonyConsequence(ev);
    // B51/audit C5: on the WEEK ROLLOVER (the eviction's result lands → a new week begins) untended
    // relationships decay slowly toward baseline — grudges and bonds fade if not refreshed, so the house
    // doesn't pin to extremes over a season. Slow (`DECAY_RATE`), disposition-scaled, threat lingers.
    // E43: week-scoped promises whose week just passed un-broken resolve KEPT at the same boundary.
    if (ev && ev.beat === "eviction-result") {
      this.rel.decay(RELATIONSHIP_CONSTANTS.DECAY_RATE);
      this.deals.expireWeekScoped(this.live?.week ?? 0);
    }
    this.syncProjection();
    this.prunePresence(); // the just-evicted occupy no room (0049)
    this.persist();
  }

  /** The beats whose directly-involved houseguests confess (E55: noms, the veto ceremony, eviction). */
  private confessorsFor(ev: BeatEvent): { involved: EntityId[]; trigger: string } | null {
    const s = this.live;
    if (!s) return null;
    switch (ev.beat) {
      case "nominations":
        return {
          involved: [s.hoh, ...(s.nominees ?? [])].filter((id): id is EntityId => !!id),
          trigger: "the nomination ceremony",
        };
      case "veto-ceremony":
        return {
          involved: [s.vetoHolder, s.saved, s.replacement, s.hoh].filter((id): id is EntityId => !!id),
          trigger: "the veto ceremony",
        };
      case "eviction": {
        // The survivors of the vote confess: the HOH whose week it was + the nominee who stayed.
        const survivor = s.eviction?.nominees.find((n) => n !== ev.participants[0]);
        return {
          involved: [s.hoh, survivor].filter((id): id is EntityId => !!id),
          trigger: "the eviction vote",
        };
      }
      default:
        return null;
    }
  }

  /**
   * Record each involved NPC's Vault-only confessional at the week's dramatic beats (0040, extended
   * by audit E55): STRUCTURED — it names its trigger, carries the confessor's soul mood, varies its
   * phrasing by seed — and now reaches the NPC's own SOUL (audit C12: `recordConfessionalToSoul` +
   * the durable `soul.memory` mirror), so a houseguest can recall their own past confessionals.
   */
  private recordCeremonyConfessionals(ev: BeatEvent): void {
    const s = this.live;
    if (!s || !this.house || !this.onPlayerEvent) return;
    const at = this.confessorsFor(ev);
    if (!at) return;
    const everyone = [this.house.player.id, ...this.house.npcs.map((n) => n.id)];
    const ctxFor = (npc: EntityId): ConfessionalContext => ({
      trigger: at.trigger,
      ...(this.soulObj(npc) ? { emotionalState: this.soulObj(npc)!.emotionalState } : {}),
      rng: new SeededRandom(hashSeed(`${this.gameSeed ?? ""}:confessional:${npc}:${s.week}:${ev.beat}`)),
    });
    for (const conf of involvedConfessionals(at.involved, everyone, this.rel, ctxFor)) {
      // witnessSet = [the confessing NPC] → hidden=true (the player is never a witness, 0002).
      this.onPlayerEvent(conf.content, [conf.npc], "confessional");
      // C12: the confessional deepens the confessor's own recall-able soul (0024/0040) — durable
      // via the soul.memory mirror (rebuildSoulIndex replays it after a restart, 0030).
      this.soulObj(conf.npc)?.memory.push(conf.content);
      if (this.soul) recordConfessionalToSoul(this.soul, conf);
    }
  }

  /**
   * NPC↔NPC deals exist (audit E46): at the nomination ceremony, the tightest UNBOUND pair of
   * living NPCs occasionally seals a pact of their own — Vault-held (the made event's witness set
   * excludes the player ⇒ hidden, 0002), binding through the SAME ledger the votes reconcile
   * against (E42), with full break consequences (betrayal fold, jury demerit, hidden reveal).
   * Seeded + bounded by `DECISION.npcDeal`; the player learns of one only along a pathway.
   */
  private mintNpcDeal(): void {
    const s = this.live;
    if (!s || !this.house || !this.onPlayerEvent) return;
    const D = DECISION.npcDeal;
    const rng = new SeededRandom(hashSeed(`${this.gameSeed ?? ""}:npc-deal:${s.week}`));
    if (rng.next() >= D.mintProb) return;
    const npcs = s.active.filter((id) => id !== PLAYER);
    const bound = (a: EntityId, b: EntityId): boolean =>
      this.deals.open().some((d) => d.parties.includes(a) && d.parties.includes(b));
    let best: [EntityId, EntityId] | null = null;
    let bestTrust: number = D.mutualTrustMin;
    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        const a = npcs[i]!, b = npcs[j]!;
        if (bound(a, b)) continue;
        const mutual = Math.min(this.rel.edge(a, b).trust, this.rel.edge(b, a).trust);
        if (mutual >= bestTrust) { bestTrust = mutual; best = [a, b]; }
      }
    }
    if (!best) return;
    const kind = bestTrust >= D.finalTwoTrustMin ? "final-two" : "safety";
    const [a, b] = best;
    // A vague paraphrase, not hidden numbers — but still Vault-held (no player witness).
    const evId = this.onPlayerEvent(
      `${this.nameOf(a)} and ${this.nameOf(b)} quietly seal a ${kind} pact`,
      [a, b], "deal",
    );
    this.deals.make(best, kind, "a quiet pact sealed away from the cameras", evId, s.week);
  }

  /** Vault-free projection of a player-party deal: parties (names) + kind + terms + status. No numbers. */
  private dealView(d: Deal): DealView {
    return {
      id: d.id,
      parties: d.parties.map((id) => ({ id, name: this.nameOf(id) })),
      kind: d.kind,
      terms: d.terms,
      status: d.status,
    };
  }

  /** Project the live-loop state onto the public week/phase/ceremony the status panel reads. */
  private syncProjection(): void {
    const s = this.live;
    if (!s) return;
    this.week = s.week;
    this.phase = s.finished ? "finale" : s.beat;
    this.ceremony = {
      hoh: s.hoh,
      nominees: (s.finalNominees ?? s.nominees ?? []).slice(),
      vetoHolder: s.vetoHolder,
      vetoUsed: s.vetoUsed,
    };
  }

  private toDecisionInput(req: SubmitDecisionReq): DecisionInput {
    switch (req.kind) {
      case "nominations": {
        const c = req.choice ?? [];
        if (c.length !== 2) throw new Error("nominations require exactly two houseguests");
        return { kind: "nominations", choice: [c[0]!, c[1]!] };
      }
      case "veto-decision":
        return { kind: "veto-decision", use: !!req.use, ...(req.save ? { save: req.save } : {}) };
      case "comp-intent": { // B46: the player declares compete/throw/play-safe.
        // The pending presents this as a generic options/pick decision (id = the intent value), so a
        // caller may submit it as `intent`, `vote`, OR `choice` like every other options/pick decision.
        // `singlePickId` covers `vote`/`choice`; `intent` stays first (R4-02 — `choice` was rejected).
        const intent = (req.intent ?? singlePickId(req)) as Intent | undefined;
        if (!intent || !(COMP_INTENTS as readonly string[]).includes(intent)) throw new Error("a legal competition intent is required");
        return { kind: "comp-intent", intent };
      }
      case "houseguests-choice": { // B45: the player picks the sixth veto player (A10: `vote` or `choice`).
        const pick = singlePickId(req);
        if (!pick) throw new Error("a Houseguest's Choice pick is required");
        return { kind: "houseguests-choice", pick };
      }
      case "replacement": { // D5-1: accept `replacement`, `vote`, OR `choice` (the generic options/pick shape).
        const replacement = req.replacement ?? singlePickId(req);
        if (!replacement) throw new Error("a replacement nominee is required");
        return { kind: "replacement", replacement };
      }
      case "eviction-vote": { // D5-1: the most-repeated decision now accepts `vote` OR `choice` (A10/R4-02 parity).
        const vote = singlePickId(req);
        if (!vote) throw new Error("an eviction vote is required");
        return { kind: "eviction-vote", vote };
      }
      case "tie-break": { // B44: the player HOH breaks a tied eviction vote (A10: `vote` or `choice`).
        const evict = singlePickId(req);
        if (!evict) throw new Error("a tie-break vote is required");
        return { kind: "tie-break", evict };
      }
      case "final-eviction": { // Final 3 (0045): the final HOH evicts (A10: `vote` or `choice`).
        const evict = singlePickId(req);
        if (!evict) throw new Error("a final-eviction target is required");
        return { kind: "final-eviction", evict };
      }
      case "goodbye-message": { // E34: the tone is surfaced as options/pick, so accept `vote` OR `choice`
        // (B6-02 — `singlePickId` is the shared parity helper; a client using the generic `choice`
        // shape was hard-looping on a rejection, like comp-intent before R4-02).
        const tone = singlePickId(req) as GoodbyeTone | undefined;
        if (!tone || !(GOODBYE_TONES as readonly string[]).includes(tone)) {
          throw new Error("a legal goodbye tone is required (warm / respectful / cold)");
        }
        return { kind: "goodbye-message", tone, ...(req.statement ? { message: req.statement } : {}) };
      }
      // --- finale (0037) ---
      case "finale-statement":
        return { kind: "finale-statement", statement: req.statement ?? "" };
      case "juror-question": // E37: scoreless free text — nothing here can sway the tally.
        return { kind: "juror-question", question: req.statement ?? "" };
      case "finale-answer": {
        if (!req.appeal || !(FINALE_APPEALS as readonly string[]).includes(req.appeal)) {
          throw new Error("a legal finale appeal is required");
        }
        return { kind: "finale-answer", appeal: req.appeal as FinaleAppeal };
      }
      case "juror-vote": { // D5-1: the player-juror's finale vote accepts `vote` OR `choice` (A10 parity).
        const vote = singlePickId(req);
        if (!vote) throw new Error("a juror vote is required");
        return { kind: "juror-vote", vote };
      }
      case "self-evict": // 0061: intercepted in `submitDecision` BEFORE this map — never reached here.
        return { kind: "self-evict", confirmed: req.confirmed === true };
    }
  }

  private named(id?: EntityId): NamedRef | null {
    return id ? { id, name: this.nameOf(id) } : null;
  }

  private pendingView(): PendingDecisionView | null {
    const p = this.live?.pending;
    // 0061: surface the OOC self-evict CONFIRMATION. A ceremony pending is a hard stop and takes
    // priority (the in-flight ceremony resolves first, §4.6 — the confirmation waits); when the loop
    // is not blocked on a ceremony decision, the raised confirmation shows on the player-level channel.
    if (!p && this.live?.selfEvictPending && this.house) {
      const by = this.named(PLAYER)!;
      return {
        kind: "self-evict", by,
        prompt: "Leaving the game is final — a real walk-out you cannot undo. Confirm to self-evict and end your season, or cancel to stay in the house.",
        options: [], pick: 0,
      };
    }
    if (!p) return null;
    const by = this.named(p.by)!;
    const refs = (ids: EntityId[]): NamedRef[] => ids.map((id) => ({ id, name: this.nameOf(id) }));
    switch (p.kind) {
      case "nominations":
        return { kind: p.kind, by, prompt: "You are Head of Household — name two houseguests for eviction.", options: refs(p.options), pick: 2 };
      case "veto-decision":
        // The 0034 legal-options contract (E36): the options ARE the legally saveable nominees.
        // At Final 4 no replacement exists, so the set is EMPTY and the prompt says why — the
        // engine never offers "use" only to silently invert it into "does not use the veto".
        return p.saveable.length === 0
          ? { kind: p.kind, by, prompt: "You hold the Power of Veto — but no replacement nominee exists at Final 4, so the veto cannot change the nominations. Confirm leaving them standing.", options: [], pick: 1 }
          : { kind: p.kind, by, prompt: "You hold the Power of Veto — use it to save a nominee, or leave the nominations.", options: refs(p.saveable), pick: 1 };
      case "comp-intent":
        // The "options" ARE the three intents (id = the intent value), so the generic decision path
        // and the front-end both pick from them; the first ("compete") is the default (B46/audit B5).
        return { kind: p.kind, by, prompt: "Declare your approach to this competition: compete, throw, or play it safe.", options: COMP_INTENTS.map((i) => ({ id: i, name: i })), pick: 1 };
      case "houseguests-choice":
        return { kind: p.kind, by, prompt: "You drew Houseguest's Choice — pick the sixth houseguest to play in the veto competition.", options: refs(p.options), pick: 1 };
      case "replacement":
        return { kind: p.kind, by, prompt: `You used the veto on ${this.nameOf((p as { saved: EntityId }).saved)} — name a replacement nominee.`, options: refs(p.options), pick: 1 };
      case "eviction-vote":
        return { kind: p.kind, by, prompt: "Cast your vote to evict one of the two nominees.", options: refs(p.nominees), pick: 1 };
      case "tie-break":
        return { kind: p.kind, by, prompt: "The eviction vote is tied — as Head of Household you cast the deciding vote.", options: refs(p.nominees), pick: 1 };
      case "final-eviction":
        return { kind: p.kind, by, prompt: "You are the final Head of Household — evict one houseguest; the other sits beside you at the Final 2.", options: refs(p.options), pick: 1 };
      // --- eviction night (E34): the player's own goodbye — tone is THEIR choice, never engine-read ---
      case "goodbye-message":
        return {
          kind: p.kind, by,
          prompt: `${this.nameOf(p.evictee)} has been evicted — record your goodbye message. Choose its tone; your own words carry it.`,
          options: p.tones.map((t) => ({ id: t, name: t })),
          evictee: this.named(p.evictee)!, pick: 1,
        };
      // --- finale (0037) ---
      case "finale-statement":
        return { kind: p.kind, by, prompt: "You are a finalist — give your opening statement to the jury.", options: [], pick: 0 };
      case "finale-answer":
        return {
          kind: p.kind, by,
          prompt: `${this.nameOf(p.juror)} asks you a question — choose how you make your case.`,
          options: [], appeals: [...p.appeals], juror: this.named(p.juror)!, pick: 1,
        };
      // --- finale (E37): the player-juror's own question (scoreless free text) ---
      case "juror-question":
        return {
          kind: p.kind, by,
          prompt: `You sit on the jury — ask ${this.nameOf(p.finalist)} your question. It sways nothing by itself; their answer is theirs.`,
          options: refs([p.finalist]), finalist: this.named(p.finalist)!, pick: 0,
        };
      case "juror-vote":
        return { kind: p.kind, by, prompt: "You sit on the jury — cast your vote for the winner.", options: refs(p.finalists), pick: 1 };
      case "self-evict":
        // 0061: the self-evict confirmation never lives on `this.live.pending` (it rides
        // `selfEvictPending`, surfaced above), so this branch is unreachable — handled for
        // type-exhaustiveness only.
        return { kind: p.kind, by, prompt: "Confirm to self-evict, or cancel to stay.", options: [], pick: 0 };
    }
  }

  private advanceView(ev: BeatEvent | null): AdvanceView {
    const s = this.live;
    return {
      started: this.house !== null,
      event: ev ? { beat: ev.beat, content: this.humanize(ev.content) } : null,
      pending: this.pendingView(),
      status: this.gameStatus(),
      finished: !!s?.finished,
      winner: this.named(s?.winner),
      finale: this.finaleView(),
      eviction: this.evictionView(),
    };
  }

  /**
   * Vault-free projection of an in-progress weekly eviction (0047): the two nominees, the stage, and
   * the votes REVEALED SO FAR (`revealIx`) only — never an unread vote, never a pre-reveal tally, never
   * the evictee before the last vote lands. Null unless an eviction is actively staging.
   */
  private evictionView(): EvictionView | null {
    const e: EvictionProgress | undefined = this.live?.eviction;
    if (!e || this.live?.finished) return null;
    const ref = (id: EntityId): NamedRef => ({ id, name: this.nameOf(id) });
    return {
      stage: e.stage,
      nominees: e.nominees.map(ref),
      // E12: secret ballots — the projection carries the anonymized ballots read so far, never
      // the voter; the attribution unseals only in the post-season retrospective (0048).
      votesRevealed: e.revealOrder.slice(0, e.revealIx).map((voter) => ({
        votedFor: ref(e.voteOf[voter]!),
      })),
    };
  }

  /**
   * Vault-free projection of an in-progress finale (0037): names, the current stage, the
   * juror asking, and the votes REVEALED SO FAR (`revealIx`) only. No lean, no tally, no
   * manner, and no pre-reveal winner ever crosses — a juror's vote appears only after it is
   * revealed in order. Null unless the finale is actively staging.
   */
  finaleView(): FinaleView | null {
    const f: FinaleProgress | undefined = this.live?.finale;
    if (!f || this.live?.finished) return null;
    const ref = (id: EntityId): NamedRef => ({ id, name: this.nameOf(id) });
    const q = f.script.questions[f.questionIx];
    return {
      stage: f.stage,
      finalists: f.finalists.map(ref),
      asking: f.stage === "questions" && q ? ref(q.juror) : null,
      reveals: f.script.revealOrder.slice(0, f.revealIx).map((juror) => ({
        juror: ref(juror), votedFor: ref(f.votes![juror]!),
      })),
    };
  }

  /** Replace raw entity ids in a loop event string with the houseguests' public names.
   *  Delegates to the whole-token substituter so beat prose like "the veto players are drawn"
   *  is never mangled by the player's bare-word id "player" (audit A8). */
  private humanize(content: string): string {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    return humanizeIds(content, all);
  }

  /**
   * The POST-SEASON retrospective scrub (0048 — the Wall's ONE sanctioned reveal). Stronger than the
   * everyday `humanize`: it also resolves ids embedded in COMPOUND machine tokens (`thread:npc:8:0`),
   * drops the bare `thread:…` identifier, and translates the thread audit slugs (`[dormant]`, `surfaces
   * via:`, …) into readable prose — so the unsealed story reads like prose, not a debug dump. Used ONLY
   * here, behind the terminal-state gate.
   */
  private retroScrub(content: string): string {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    return humanizeForRetrospective(content, all);
  }

  getGameState(): GameStateView {
    return this.view();
  }

  getMomentPrompt(req: MomentPromptReq): MomentPromptView {
    const view = this.view();
    const moment = req.moment ?? view.moment;
    return {
      moment,
      systemPrompt: buildSystemPrompt(
        moment, view, this.storyFacts(moment), this.worldContext(moment), this.producerVoice(moment),
      ),
    };
  }

  /**
   * The producer persona for this season — a REAL generated character (as deep as any houseguest, built
   * by the same `CharacterFactory` machinery) but OFF-CAMERA: no headshot, not one of the 16, never in
   * the roster/portraits/whereabouts. Seeded for reproducibility. The interview runs PRE-GAME (before
   * there is a season seed), so the producer's seed is established LAZILY here the first time it's needed,
   * with real entropy, then PERSISTED — so the same producer is voiced every turn of the interview and
   * survives a restart, and `createCharacter` reuses the very same seed into the season. Cached.
   */
  private producer(): Producer {
    if (this.producerSeed === null) {
      // First need (pre-game): mint a stable seed and persist it, so the SAME producer is voiced for the
      // whole interview and survives a restart. (Once a game starts, the season seed is used — see below.)
      this.producerSeed = entropySeed();
      this.producerCache = null;
      this.persist();
    }
    if (!this.producerCache) this.producerCache = producerForSeed(this.producerSeed);
    return this.producerCache;
  }

  /**
   * The producer-persona block woven into the casting-interview prompt (facts to voice, ADR 0003): the
   * model voices THIS specific, seeded producer consistently. Present ONLY on the pre-game casting beat
   * (`character-creation`); every other moment is a houseguest/host beat with no producer voice. Vault-free
   * by construction — the producer carries only PUBLIC voice flavor, never a hidden number or secret.
   */
  private producerVoice(moment: string): string | undefined {
    if (moment !== "character-creation") return undefined;
    return renderProducerVoice(this.producer());
  }

  /**
   * The Vault-free "world you all moved in with" block (feature 0062, §5/§7) woven into the moment
   * prompt — built from the FROZEN persisted snapshot, scaled by the live week (the longer the season,
   * the more dated the house, §7). `social` (and any off-screen) moment gets the off-screen framing (the
   * C32-beyond delta — NPC-to-NPC life shares the same world); every other live moment gets the player
   * framing. Pre-game / no-snapshot ⇒ "" (the §8 fail-soft path; the prompt is unchanged). Public flavor
   * by construction — it reads ONLY the public snapshot, never a hidden number.
   */
  private worldContext(moment: string): string | undefined {
    if (!this.worldSnapshot || !this.house) return undefined;
    const channel = moment === "social" || moment === "diary-room" ? "offscreen" : "player";
    const block = renderZeitgeist(this.worldSnapshot, { week: this.week, channel });
    return block.length > 0 ? block : undefined;
  }

  /**
   * The Vault-free projection of the move-in zeitgeist snapshot (feature 0062) — the FROZEN shared
   * real-world flavor the cast moved in WITH, plus the off-screen-channel "world you moved in with"
   * BLOCK an NPC-to-NPC society/gossip scene is colored by (§5, the C32-beyond delta). `null` pre-game
   * or when no snapshot was captured (the §8 fail-soft skip). Public, shared flavor — never Vault, never
   * a game input (§6): it carries no secret and no number, and reading it changes no outcome.
   */
  worldSnapshotView(): WorldSnapshotView | null {
    // The §8 ABSENT tier reads as "no snapshot present" — an absent snapshot has no voiceable content,
    // so the public view is null (it round-trips as absent). `hasZeitgeist` gates present-and-non-empty.
    if (!this.house || !hasZeitgeist(this.worldSnapshot)) return null;
    const snap = this.worldSnapshot;
    return {
      capturedFor: snap.capturedFor,
      source: snap.source,
      // PUBLIC slices only — `capturedAt`/`lagDays` are operational provenance, never surfaced.
      slices: cloneSession(snap.slices),
      offscreenPrompt: renderZeitgeist(snap, { week: this.week, channel: "offscreen" }),
    };
  }

  /**
   * The FE-owned write-back seam (feature 0062, §8) — the front-end (which owns the concrete `web_search`
   * provider, like the 0051 image port) captures a REAL move-in zeitgeist at season creation and writes
   * it back here so the ENGINE persists it as the single frozen artifact (it then RECALLS it, never
   * re-searches, §9). REPLACES the deterministic `model-framed` fallback for this season (idempotent),
   * freezing it byte-stable thereafter. Outward-safe by construction: the payload is PUBLIC real-world
   * flavor (§6) — no Vault handle, no secret, no game input. A no-op before a game starts (nothing to
   * freeze onto). The slices are bounded to the budget (§11 #3); empty slices keep the fallback's value
   * so a partial capture never thins the snapshot (non-degradation).
   */
  recordWorldSnapshot(req: RecordWorldSnapshotReq): RecordWorldSnapshotResult {
    if (!this.house || !this.worldSnapshot) return { accepted: false, source: "absent" };
    const base = this.worldSnapshot;
    const cap = ZEITGEIST.itemsPerSlice;
    const merge = (key: ZeitgeistSlice): string[] => {
      const incoming = req.slices?.[key];
      // Sanitize untrusted FE text (flatten control chars that could forge a prompt line; cap length +
      // count). An empty/absent slice keeps the fallback's value (non-degradation — never thin it).
      if (!Array.isArray(incoming) || incoming.length === 0) return [...base.slices[key]];
      return incoming
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, cap)
        .map((s) => sanitizeFlavor(s));
    };
    const moodIn = typeof req.slices?.mood === "string" ? req.slices.mood : undefined;
    this.worldSnapshot = {
      capturedFor: typeof req.capturedFor === "string" && req.capturedFor.trim() ? sanitizeFlavor(req.capturedFor, 80) : base.capturedFor,
      capturedAt: typeof req.capturedAt === "string" ? sanitizeFlavor(req.capturedAt, 80) : base.capturedAt,
      lagDays: base.lagDays,
      source: "web_search",
      slices: {
        screen: merge("screen"), music: merge("music"), sports: merge("sports"),
        news: merge("news"), internet: merge("internet"),
        mood: moodIn && moodIn.trim() ? sanitizeFlavor(moodIn) : base.slices.mood,
      },
    };
    this.persist(); // durable (0030): the captured snapshot must survive a restart, frozen
    return { accepted: true, source: "web_search" };
  }

  /** How many recorded witnessed events ground a server-initiated lifecycle beat (B62). */
  private static readonly STORY_FACT_EVENTS = 8;

  /**
   * The story-so-far facts for a server-initiated lifecycle beat (B62/audit J1+J7+J2): the most
   * recent WITNESSED events from the record — the store recalled, never the chat remembered
   * (ADR 0003) — plus the result for a finished season. Vault-free by construction: hidden
   * events never enter, and the winner/week are public ceremony facts. Other moments get none
   * (the per-turn prompt stays tight — prefer removing context to adding it).
   */
  private storyFacts(moment: string): string | undefined {
    if (moment !== "re-entry" && moment !== "post-season") return undefined;
    const recent = (this.record?.events() ?? [])
      .filter((e) => !e.hidden)
      .slice(-GameSessionAdapter.STORY_FACT_EVENTS)
      .map((e) => ({ content: this.humanize(e.content) }));
    const winner = this.live?.finished ? this.named(this.live.winner) : null;
    // Anti-confabulation (priority #3): the reunion/recap was inventing the jury margin and the
    // player's own placement (a real playtest defect — "9-2" for an 8-1 vote, "Final 5" for a Final
    // 6 exit). Hand the model the EXACT public finale facts so it voices them instead of embellishing.
    const tally = this.live?.finished ? this.finaleTally() : null;
    const playerSeason = this.live?.finished ? this.playerSeason() : null;
    return renderStoryFacts(
      recent,
      winner ? { winner: winner.name, week: this.week, ...(tally ? { tally } : {}) } : null,
      playerSeason,
    );
  }

  /** The exact, public jury vote margin (anti-confabulation grounding for the recap). Counts the
   *  persisted finale ballots per finalist; null until a winner + Final 2 + ballots exist. */
  private finaleTally(): { winnerVotes: number; runnerUpVotes: number; runnerUp: string } | null {
    const votes = this.live?.finale?.votes;
    const winner = this.live?.winner;
    const finalTwo = this.live?.finalTwo;
    if (!votes || !winner || !finalTwo) return null;
    const runnerUp = finalTwo.find((id) => id !== winner);
    if (!runnerUp) return null;
    let winnerVotes = 0, runnerUpVotes = 0;
    for (const choice of Object.values(votes)) {
      if (choice === winner) winnerVotes += 1;
      else if (choice === runnerUp) runnerUpVotes += 1;
    }
    return { winnerVotes, runnerUpVotes, runnerUp: this.nameOf(runnerUp) };
  }

  /** The player's OWN public placement, stated exactly so the recap can't inflate it (Final N they
   *  went out at, the eviction week, jury seat + their finale vote). Public ceremony facts only. */
  private playerSeason(): string | null {
    if (!this.house || !this.live) return null;
    const me = this.house.player.id;
    if (this.live.winner === me) return "You WON the season.";
    if (this.live.finalTwo?.includes(me)) return "You finished as the RUNNER-UP (the Final 2).";
    const idx = this.live.evictionOrder.indexOf(me);
    if (idx < 0) return null;
    const cast = this.house.npcs.length + 1;
    const finalN = cast - idx; // houseguests remaining (incl. the player) when they were evicted
    const week = this.live.voteRecord?.find((r) => r.evictee === me)?.week;
    let s = `You were evicted${week ? ` in week ${week}` : ""}, going out at the Final ${finalN}`;
    if (this.seatOf(me) === "jury") {
      s += ", then sat on the jury";
      const vote = this.live.finale?.votes?.[me];
      if (vote) s += ` and voted for ${this.nameOf(vote)} to win`;
    }
    return s + ".";
  }

  /**
   * Report the live loop's competition — it is NOT a second resolver (B37/audit A1+A3). The weekly
   * loop (`advanceGame` → `liveSeason`) is the SOLE authority on who wins; `runCompetition` only
   * PREVIEWS the current competition beat's deterministic winner (the loop crowns the same one when
   * the beat advances — same seed). Per remediation principle #3 it validates references and ignores
   * foreign input: ids only, unknown/evicted ids refused, caller stats never read.
   */
  runCompetition(req: RunCompetitionReq): CompetitionResultView {
    const fallbackType = (COMP_TYPES.has(req.type ?? "") ? req.type : "endurance") as CompetitionType;
    if (!this.house) return { started: false, type: fallbackType, week: 0, phase: this.phase, winner: null };

    // Validated references: any caller-supplied id must be a LIVING houseguest (never evicted/unknown).
    if (req.participantIds?.length) {
      const known = new Set([this.house.player.id, ...this.house.npcs.map((n) => n.id)]);
      const evicted = new Set(this.live?.evictionOrder ?? []);
      if (req.participantIds.some((id) => !known.has(id) || evicted.has(id))) {
        return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: null };
      }
    }

    // Single authority: the field + winner come from the loop, computed from the live house's own
    // stats/souls (caller stats ignored). The evicted are never in an eligibility pool by construction.
    if (this.live) {
      const peek = peekCompetition(this.live, this.ctx(), this.beatRng());
      if (peek) {
        // The drawn library def (0042): name + format + the Vault-free narrative scaffold — the
        // narrator dresses THIS competition. Flavor only; no stat, score, or ranking crosses.
        return {
          started: true, type: peek.type, week: this.week, phase: this.phase,
          winner: this.named(peek.winner),
          name: peek.def.name, format: peek.def.format,
          narrative: {
            premise: peek.def.narrative.premise,
            beats: [...peek.def.narrative.beats],
            winReads: peek.def.narrative.winReads,
          },
        };
      }
      // Between competitions: report the most recently crowned comp from public ceremony state — no re-roll.
      const last = this.ceremony.vetoHolder ?? this.ceremony.hoh;
      return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: last ? this.named(last) : null };
    }
    return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: null };
  }

  /**
   * Where the player stands (0046). `active` until they are evicted; once evicted, `jury` if they fall
   * in the last-9 jury (they spectate the public ceremonies and vote at the finale) or `evicted` if they
   * went out pre-jury. Derived purely from the public eviction order + the (fixed) cast size — the jury
   * is the last 9 of the `cast − 2` evictions, so a player evicted at index ≥ that threshold is a juror.
   * Vault-free: nothing here reads a hidden number.
   */
  private playerStatus(): "active" | "jury" | "evicted" {
    // 0061 (owner decision #1): a CONFIRMED self-eviction is a FORFEIT — the player exits the game
    // entirely and never takes a juror's seat, even in the jury phase. So a self-evicted player
    // always reads "evicted" (terminal), overriding the phase-derived seat the eviction index would give.
    if (this.live?.selfEvicted) return "evicted";
    return this.seatOf(PLAYER);
  }

  /** Any houseguest's public seat (B61): still playing, on the last-9 jury, or out pre-jury. */
  private seatOf(id: EntityId): "active" | "jury" | "evicted" {
    const order = this.live?.evictionOrder ?? [];
    const idx = order.indexOf(id);
    if (idx < 0) return "active";
    const cast = this.house ? this.house.npcs.length + 1 : 16;
    const preJury = Math.max(0, cast - 2 - 9); // evictions before the last-9 jury forms
    return idx >= preJury ? "jury" : "evicted";
  }

  /** The Vault-free projection. Player card = authored persona (no numeric stats); NPCs = name + status only. */
  private view(): GameStateView {
    if (!this.house) {
      // Pre-game, the view carries the interview's status (0050): the engine — not the model —
      // says which building blocks are in and what the next step is.
      return {
        started: false, finished: false, week: 0, phase: this.phase, moment: "character-creation",
        ceremony: { hoh: null, nominees: [], veto: { holder: null, used: false, players: [] } },
        whereabouts: null,
        player: null, house: [], casting: castingStatusOf(this.intake),
      };
    }
    const p = this.house.player;
    const status = this.playerStatus();
    // Once the player is out, the moment frames their new seat (closure / the jury spectator box, 0046)
    // rather than the ceremony phase they can no longer act in. An active player keeps the phase moment.
    // 0061: a VOLUNTARY walk-out gets its own terminal framing (the season is over for them by their OWN
    // choice — no crowned winner to host a reunion around, unlike `post-season`). It trumps every seat.
    // Otherwise the finished terminal state (0048) trumps every seat: the season is over, the reunion begins.
    const moment = this.live?.selfEvicted
      ? "self-evicted"
      : this.live?.finished
      ? "post-season"
      : status === "evicted" ? "evicted" : status === "jury" ? "jury" : momentForPhase(this.phase);
    return {
      started: true,
      finished: !!this.live?.finished, // B6-01: the over-signal the FE season lifecycle (0057) gates on
      // C8-04: the live ceremony state in the model's persistent context (the same Vault-free public
      // facts gameStatus() exposes), so the narrator voices the REAL HOH/nominees/veto, never invents.
      ceremony: {
        hoh: this.card(this.ceremony.hoh),
        nominees: this.ceremony.nominees.map((id) => ({ id, name: this.nameOf(id) })),
        veto: {
          holder: this.card(this.ceremony.vetoHolder),
          used: this.ceremony.vetoUsed,
          players: (this.live?.vetoField ?? []).map((id) => ({ id, name: this.nameOf(id) })), // R9-AGENCY-1: the drawn six
        },
      },
      // L21/L24: the player's live whereabouts (room, who's with them + tenure, adjacent rooms) so the
      // narrator voices the REAL, persistent occupancy the engine drives — never invented positions.
      whereabouts: this.whereabouts(),
      week: this.week,
      phase: this.phase,
      moment,
      player: {
        id: p.id,
        name: p.name,
        // Surface the player's OWN words (what they typed at OOBE) so the narrative voices them as
        // described; fall back to the canonical labels. Stats stay hidden behind the Vault either way.
        archetype: p.persona?.archetype ?? p.character.archetype,
        strategyStyle: p.persona?.strategyStyle ?? p.character.strategyStyle,
        status,
        // The casting card (0050): the interview's payoff, re-showable all season. Tier WORDS are
        // derived from the hidden balanced stats here, engine-side — the numbers never serialize out.
        castingCard: {
          characterType: p.character.archetype,
          strategyStyle: p.character.strategyStyle,
          strengths: {
            physical: strengthTier(p.character.stats.physical),
            mental: strengthTier(p.character.stats.mental),
            social: strengthTier(p.character.stats.social),
          },
          ...(p.character.background ? { story: p.character.background } : {}),
          ...(p.motivation ? { motivation: p.motivation } : {}),
          // C6: an engine-defaulted character type is SURFACED, never a silent grant.
          ...(p.archetypeDefaulted ? { defaulted: true } : {}),
        },
      },
      house: this.house.npcs.map((n) => ({
        id: n.id, name: n.name,
        status: this.seatOf(n.id),
        // B61: the curated PUBLIC persona facets — the narrator's per-person voice anchor
        // (seed-stable, so a houseguest sounds the same in week 8 as week 1). Stats, the
        // soul, and hiddenElements are deliberately NOT selected here.
        archetype: n.character.archetype,
        strategyStyle: n.character.strategyStyle,
        background: n.character.background,
        age: n.character.age,
        presentation: n.character.presentation,
        // L28: the concrete, diverse, PERSISTED backstory facets — the narrator voices the STORED
        // vocation/hometown instead of inventing (and mirroring the player's). Public, Vault-free.
        ...(n.character.vocation !== undefined ? { vocation: n.character.vocation } : {}),
        ...(n.character.hometown !== undefined ? { hometown: n.character.hometown } : {}),
        // L28 (voice register): the STORED observable demeanor — the narrator voices THIS so the cast
        // is not a room of identical warm professionals. Public, Vault-free.
        ...(n.character.demeanor !== undefined ? { demeanor: n.character.demeanor } : {}),
        // 0058: the PUBLIC multi-sentence biography. Public, Vault-free; the HIDDEN profile
        // (secrets/goals/weakness/perception) is NEVER selected here.
        ...(n.character.biography !== undefined ? { biography: n.character.biography } : {}),
        // L29 single physical descriptor (appearance/physicalCharacteristics consistency): the STRUCTURED
        // `physicalCharacteristics` facet is the ONE source of truth narration AND portraits read; the prose
        // `appearance` rides ONLY as the pre-0058 fallback — NEVER both (independently generated, they could
        // contradict on build/skin/hair). When the facet is present it alone is shipped.
        ...(n.character.physicalCharacteristics !== undefined
          ? { physicalCharacteristics: n.character.physicalCharacteristics }
          : n.character.appearance !== undefined ? { appearance: n.character.appearance } : {}),
        // 0063: the PUBLIC diversity-identity facets — the heritage/cultural identity (an authentic facet
        // of a full character, grounding the skin tone), the gender presentation, and a PUBLICLY-OUT
        // orientation only. A PRIVATELY-held orientation is NEVER here (it's Vault-sealed, §5). Descriptive
        // only — the narrator voices them as it would any public facet, never a defining single word.
        ...(n.character.ethnicity !== undefined ? { ethnicity: n.character.ethnicity } : {}),
        ...(n.character.genderPresentation !== undefined ? { genderPresentation: n.character.genderPresentation } : {}),
        ...(n.character.outOrientation !== undefined ? { outOrientation: n.character.outOrientation } : {}),
      })),
      // Deals the player is party to (0039) — fact + status only; NPC↔NPC deals never appear here.
      deals: this.deals.forParty(PLAYER).map((d) => this.dealView(d)),
      // 0059/L40 — only PUBLIC (visible) showmances; sealed ties/showmances never surface here.
      ...(this.visibleShowmances().length ? { showmances: this.visibleShowmances() } : {}),
      // PREMIERE (feature #380 follow-on): the meet-everyone progress — who's met + who's still to
      // introduce + their OBSERVABLE persona — woven into the premiere moment prompt so the producer
      // never loses track. Present ONLY during the premiere (null otherwise). Vault-free public facets.
      ...(this.premiereIntros() ? { premiere: this.premiereIntros()! } : {}),
    };
  }
}
