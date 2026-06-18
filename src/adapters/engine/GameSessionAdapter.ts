import type {
  GameSession, CreateCharacterReq, GameStateView, MomentPromptReq, MomentPromptView,
  RunCompetitionReq, CompetitionResultView, PublicGameStatus,
  AdvanceView, SubmitDecisionReq, PendingDecisionView, NamedRef, SocialInitiative, PlayerTaglineView,
  FinaleView, EvictionView, MakeDealReq, DealView, WhereaboutsView,
  SeasonRecapView, RetrospectiveView, NpcVoiceView,
  UpdateCastingReq, CastingStatusView, PortraitPromptEntry,
} from "../../ports/GameSession";
import { randomBytes } from "node:crypto";
import { humanizeIds } from "./humanize";
import { singlePickId } from "./decisionFields";
import type { GameEvent } from "../../domain/event";
import { assignRooms } from "../../engine/presence";
import { dayOfWeek } from "../../engine/houseEvents";
import { HOUSE_ADJACENCY } from "../../domain/house";
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
import { buildPortraitPrompt, buildCastPortraitPrompts } from "../../engine/portraitPrompts";
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
import type { CompetitionType, Intent } from "../../domain/competitionOutcome";
import { SeededRandom } from "../random/SeededRandom";
import { PLAYER } from "../../domain/ids";
import type { EntityId } from "../../domain/ids";
import { EngineRefusal } from "../../domain/errors";
import { RelationshipModel, relationshipLabel } from "../../engine/relationships";
import type { Stats } from "../../engine/season";
import {
  newLiveSeason, advance as advanceBeat, applyDecision, recordDealBetrayal, peekCompetition, COMP_INTENTS, GOODBYE_TONES,
  firstCeremonyBeatResolved,
  type LiveSeasonState, type SeasonCtx, type BeatEvent, type DecisionInput, type PendingDecision, type GoodbyeTone,
  type FinaleProgress, type EvictionProgress,
} from "../../engine/liveSeason";
import { APPROACH_GATE } from "../../engine/decisionConstants";
import { FINALE_APPEALS, type FinaleAppeal } from "../../engine/jury";
import { loadReserveTwists } from "../../engine/reserveTwists";
import { derivedLoyalty } from "../../engine/blocs";
import type { ReserveTwist, TwistKind } from "../../engine/reserveTwists";
import type { CeremonyState, SessionCore } from "../../engine/sessionSnapshot";
import { cloneSession } from "../../engine/sessionSnapshot";

const COMP_TYPES: ReadonlySet<string> = new Set<CompetitionType>([
  "endurance", "physical", "puzzle", "quiz", "memory", "mental", "social",
]);

/**
 * A fresh entropy seed for a game created WITHOUT an explicit seed (E39/C7): a uint32 from
 * `crypto` randomness, persisted in the snapshot (`gameSeed`) so the season stays reproducible
 * AFTER creation. This is an adapter (not the pure core) — the one sanctioned place real
 * entropy enters; everything downstream still flows through the seeded `RandomnessSource`.
 */
function entropySeed(): number {
  return randomBytes(4).readUInt32LE(0);
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
  /** The game's seed (B60/E12): per-moment rng keys off it — two same-named games never share streams. */
  private gameSeed: number | null = null;
  /** The per-season style anchor for portrait prompts (0051): seeded at cast time, stable through the season. */
  private portraitStyleAnchor: string | null = null;

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
        appearance: npc.character.appearance,
        presentation: npc.character.presentation,
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
      },
      this.portraitStyleAnchor,
    );
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
    const events = this.record?.events() ?? [];
    const hiddenStory = events
      .filter((e) => e.hidden)
      .map((e) => ({ type: e.type, content: this.humanize(e.content) }));
    for (const r of this.record?.hidden() ?? []) {
      if (r.kind === "reserved-twist") continue; // surfaced structurally via `twists` below
      hiddenStory.push({ type: r.kind, content: this.humanize(r.content) });
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

  /** The durable session core (0030): the live house + week/phase/ceremony + loop, losslessly. */
  snapshot(): SessionCore {
    return {
      started: this.house !== null,
      week: this.week,
      phase: this.phase,
      ceremony: { ...this.ceremony, nominees: [...this.ceremony.nominees] },
      house: this.house ? cloneSession(this.house) : null,
      live: this.live ? cloneSession(this.live) : null,
      deals: this.deals.serialize(),
      ...(this.presence ? { presence: Object.fromEntries(this.presence) as Record<EntityId, Room> } : {}),
      ...(this.gameSeed !== null ? { seed: this.gameSeed } : {}),
      ...(this.portraitStyleAnchor !== null ? { portraitStyleAnchor: this.portraitStyleAnchor } : {}),
      // A half-done casting interview is durable state too (0050/0030).
      ...(intakeIsEmpty(this.intake) ? {} : { casting: cloneSession(this.intake) }),
    };
  }

  /** Rebuild the live session from a durable snapshot (0030) — resume instead of reset. */
  restore(core: SessionCore): void {
    this.house = core.house ? cloneSession(core.house) : null;
    this.week = core.week;
    this.phase = core.phase;
    this.ceremony = { ...core.ceremony, nominees: [...core.ceremony.nominees] };
    this.live = core.live ? cloneSession(core.live) : null;
    this.deals.load(core.deals ?? []);
    // Pre-0049 saves carry no presence — migrate forward (the next tick seats everyone afresh).
    this.presence = core.presence ? new Map(Object.entries(core.presence) as [EntityId, Room][]) : null;
    this.gameSeed = core.seed ?? null; // pre-B60 saves: fall back to the legacy name-keyed streams
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
      veto: { holder: this.card(this.ceremony.vetoHolder), used: this.ceremony.vetoUsed },
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

  /** The shared room-assignment deps: live affinity (allies drift together) + the HOH-room pull. */
  private presenceDeps(rng: RandomnessSource): Parameters<typeof assignRooms>[2] {
    return {
      rng,
      affinity: (a, b) => this.rel.edge(a, b).affinity,
      hoh: this.ceremony.hoh ?? null,
    };
  }

  /**
   * Re-seat the house for a new off-screen tick (0049): every active houseguest stays put or moves
   * to an ADJACENT room, clustered by affinity, through the caller's seeded rng. The orchestrator
   * calls this once per tick; lingering player turns never move the week — only the rooms.
   */
  presenceTick(rng: RandomnessSource): void {
    if (!this.house) return;
    this.presence = assignRooms(this.presenceActive(), this.presence, this.presenceDeps(rng));
  }

  /** The live occupancy ground truth (engine/registry wiring — never projected raw to the player). */
  occupancy(): Occupancy | null {
    return this.presence;
  }

  /** Drop anyone presence still seats who is no longer active (the just-evicted are nowhere). */
  private prunePresence(): void {
    if (!this.presence) return;
    const active = new Set(this.presenceActive());
    for (const id of [...this.presence.keys()]) if (!active.has(id)) this.presence.delete(id);
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
    return {
      room,
      present: inRoom(room),
      nearby: (HOUSE_ADJACENCY.get(room) ?? []).map((r) => ({ room: r, present: inRoom(r) })),
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
    // 0051: draw ONE per-season portrait style anchor, seeded off the game seed — same seed always
    // draws the same anchor, so the house looks like itself across restarts and through the season.
    this.portraitStyleAnchor = STYLE_ANCHOR_VARIANTS[
      new SeededRandom(hashSeed(`${seed}:portrait-style`)).int(STYLE_ANCHOR_VARIANTS.length)
    ];
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
    // Seed first impressions so NPC decisions are differentiated from move-in (without this,
    // empty relationships make every HOH nominate the same first-in-roster houseguests). These
    // are starting beliefs; the consequence fold (0023) evolves them as the player acts.
    this.seedFirstImpressions(seed);
    this.wireDispositions(); // archetype → disposition (B55): grudges stick, loyalists forgive
    // Move-in (0049): seat everyone somewhere (first assignment may place anyone anywhere).
    this.presence = assignRooms(
      this.presenceActive(), null,
      this.presenceDeps(new SeededRandom(hashSeed(`${seed}:presence`))),
    );
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
    // No-op unless there's a matching pending decision to resolve (idempotent + robust
    // to malformed calls — the boundary must never throw an unhandled error).
    if (!this.house || !this.live || !this.live.pending || this.live.pending.kind !== req.kind) return this.advanceView(null);
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
    }
  }

  private named(id?: EntityId): NamedRef | null {
    return id ? { id, name: this.nameOf(id) } : null;
  }

  private pendingView(): PendingDecisionView | null {
    const p = this.live?.pending;
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

  getGameState(): GameStateView {
    return this.view();
  }

  getMomentPrompt(req: MomentPromptReq): MomentPromptView {
    const view = this.view();
    const moment = req.moment ?? view.moment;
    return { moment, systemPrompt: buildSystemPrompt(moment, view, this.storyFacts(moment)) };
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
    return renderStoryFacts(recent, winner ? { winner: winner.name, week: this.week } : null);
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
        ceremony: { hoh: null, nominees: [], veto: { holder: null, used: false } },
        player: null, house: [], casting: castingStatusOf(this.intake),
      };
    }
    const p = this.house.player;
    const status = this.playerStatus();
    // Once the player is out, the moment frames their new seat (closure / the jury spectator box, 0046)
    // rather than the ceremony phase they can no longer act in. An active player keeps the phase moment.
    // The finished terminal state (0048) trumps every seat: the season is over, the reunion begins.
    const moment = this.live?.finished
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
        veto: { holder: this.card(this.ceremony.vetoHolder), used: this.ceremony.vetoUsed },
      },
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
        appearance: n.character.appearance,
        presentation: n.character.presentation,
      })),
      // Deals the player is party to (0039) — fact + status only; NPC↔NPC deals never appear here.
      deals: this.deals.forParty(PLAYER).map((d) => this.dealView(d)),
    };
  }
}
