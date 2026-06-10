import type {
  GameSession, CreateCharacterReq, GameStateView, MomentPromptReq, MomentPromptView,
  RunCompetitionReq, CompetitionResultView, PublicGameStatus,
  AdvanceView, SubmitDecisionReq, PendingDecisionView, NamedRef, SocialInitiative, PlayerTaglineView,
  FinaleView, MakeDealReq, DealView,
} from "../../ports/GameSession";
import { DealLedger } from "../../engine/deals";
import type { BindingAction, Deal } from "../../engine/deals";
import { involvedConfessionals } from "../../engine/confessionals";
import { npcInitiatedApproaches } from "../../engine/conversation";
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
import { startNewGame, hashSeed, isPlausibleArchetype } from "../../engine/characterFactory";
import type { GameHouse, StrategyStyle, Soul } from "../../engine/characterFactory";
import { evolveEmotion, arcNote, offscreenEmotion } from "../../engine/emotionalArc";
import type { EmotionalEvent } from "../../engine/emotionalArc";
import type { SoulProvider } from "../../ports/SoulProvider";
import type { InteractionType } from "../../engine/relationships";
import { CEREMONY_IMPACTS } from "../../engine/relationshipConstants";
import type { CeremonyAct } from "../../engine/relationshipConstants";
import { buildSystemPrompt, momentForPhase } from "../../engine/momentPrompts";
import type { CompetitionType } from "../../domain/competitionOutcome";
import { SeededRandom } from "../random/SeededRandom";
import { PLAYER } from "../../domain/ids";
import type { EntityId } from "../../domain/ids";
import { RelationshipModel } from "../../engine/relationships";
import type { Stats } from "../../engine/season";
import {
  newLiveSeason, advance as advanceBeat, applyDecision, recordDealBetrayal, peekCompetition,
  type LiveSeasonState, type SeasonCtx, type BeatEvent, type DecisionInput, type PendingDecision,
  type FinaleProgress,
} from "../../engine/liveSeason";
import { FINALE_APPEALS, type FinaleAppeal } from "../../engine/jury";
import type { CeremonyState, SessionCore } from "../../engine/sessionSnapshot";
import { cloneSession } from "../../engine/sessionSnapshot";

const COMP_TYPES: ReadonlySet<string> = new Set<CompetitionType>([
  "endurance", "physical", "puzzle", "quiz", "memory", "mental", "social",
]);

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
    this.rebuildSoulIndex();
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
    this.onPersist?.();
  }

  private nameOf(id: EntityId): string {
    if (!this.house) return id;
    if (this.house.player.id === id) return this.house.player.name;
    return this.house.npcs.find((n) => n.id === id)?.name ?? id;
  }

  private card(id?: EntityId): { id: EntityId; name: string } | null {
    return id ? { id, name: this.nameOf(id) } : null;
  }

  gameStatus(): PublicGameStatus {
    return {
      week: this.week,
      phase: this.phase,
      hoh: this.card(this.ceremony.hoh),
      nominees: this.ceremony.nominees.map((id) => ({ id, name: this.nameOf(id) })),
      veto: { holder: this.card(this.ceremony.vetoHolder), used: this.ceremony.vetoUsed },
    };
  }

  /** The houseguests still in the game (player + non-evicted NPCs) — the legal references for an
   *  interaction (B39). Empty before a game starts. */
  livingIds(): EntityId[] {
    if (!this.house) return [];
    const evicted = new Set(this.live?.evictionOrder ?? []);
    return [this.house.player.id, ...this.house.npcs.filter((n) => !evicted.has(n.id)).map((n) => n.id)];
  }

  socialInitiatives(): SocialInitiative[] {
    if (!this.house) return [];
    const player = this.house.player.id;
    const npcIds = this.house.npcs.map((n) => n.id);
    // Deterministic per moment (the temperature roll cannot flip a clear relationship gap, 0012),
    // so the same week/phase reproduces the same approaches. The hidden drive is NOT surfaced —
    // only the name + a neutral pretext, so no trust/threat read leaks across the wall (0001).
    const rng = new SeededRandom(hashSeed(`approaches:${this.week}:${this.phase}`));
    return npcInitiatedApproaches(player, npcIds, this.rel, rng, 3).map((id) => ({
      houseguest: { id, name: this.nameOf(id) },
      pretext: "wants a word with you",
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
    // Non-degradation at its single most destructive point (B36/audit A2): an already-started game is
    // NEVER silently wiped. Without an explicit `confirmRestart`, a second createCharacter (a stray GM
    // call, a network caller) is a no-op returning the current state — the prior save is left intact. A
    // real restart goes through the admin reset path (registry.resetUser), not this tool.
    if (this.house && !req.confirmRestart) return this.view();
    const seed = req.seed ?? hashSeed(req.playerName);
    const archetype = req.archetype && isPlausibleArchetype(req.archetype) ? req.archetype : undefined;
    const strategyStyle = req.strategyStyle as StrategyStyle | undefined;
    // Keep the player's RAW typed words as their public persona (narrative/display), even when they
    // don't match a canonical archetype/style — so the game master voices them as they described
    // themselves. The canonical `archetype`/`strategyStyle` above still drive hidden stats (0006).
    this.house = startNewGame({
      seed, playerName: req.playerName, archetype, strategyStyle,
      ...(req.archetype ? { personaArchetype: req.archetype } : {}),
      ...(req.strategyStyle ? { personaStrategyStyle: req.strategyStyle } : {}),
    });
    this.week = 1;
    this.phase = "premiere";
    // Start the incremental weekly loop over the live house (player + NPCs).
    this.live = newLiveSeason([this.house.player.id, ...this.house.npcs.map((n) => n.id)]);
    // Seed first impressions so NPC decisions are differentiated from move-in (without this,
    // empty relationships make every HOH nominate the same first-in-roster houseguests). These
    // are starting beliefs; the consequence fold (0023) evolves them as the player acts.
    this.seedFirstImpressions(seed);
    this.onPersist?.(); // durable save (0030): a started game must survive a restart
    return this.view();
  }

  /** Give every ordered pair a seeded baseline trust/affinity/threat (deterministic per game). */
  private seedFirstImpressions(seed: number): void {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    const rng = new SeededRandom(hashSeed(`${seed}:relationships`));
    for (const a of all) for (const b of all) {
      if (a.id === b.id) continue;
      const e = this.rel.edge(a.id, b.id);
      e.trust = rng.next(); e.affinity = rng.next(); e.threat = rng.next(); e.confidence = 0.5;
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
   */
  private inflect(id: EntityId, event: EmotionalEvent): void {
    const soul = this.soulObj(id);
    if (!soul) return;
    evolveEmotion(soul, event);
    const note = arcNote(event, this.week);
    soul.memory.push(note);                 // persisted arc (house snapshot, monotonic — 0007/0030)
    this.soul?.recordToSoul(id, note);       // vector recall index (0024), when wired into the sandbox
  }

  /**
   * Evolve the involved souls from a just-resolved beat (the live consequence fold, 0041): a comp
   * winner is emboldened; on an eviction the evictee's closest surviving ally is blindsided toward
   * distress. Drives the live emotional arc that then modulates later competitions + decisions.
   */
  private evolveFromBeat(ev: BeatEvent): void {
    if (!this.house) return;
    switch (ev.beat) {
      case "hoh-competition": {
        const winner = ev.participants[0];
        if (winner) this.inflect(winner, "comp-win");
        break;
      }
      case "veto-competition": {
        const holder = this.live?.vetoHolder;
        if (holder) this.inflect(holder, "comp-win");
        break;
      }
      case "eviction": {
        const evictee = ev.participants[0];
        if (evictee) this.blindsideClosestAlly(evictee);
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

  /** Deepen a houseguest's soul from an off-screen scene (0038/0041): the house lives between turns. */
  recordOffscreenSoul(npc: EntityId, type: InteractionType): void {
    this.inflect(npc, offscreenEmotion(type));
  }

  /**
   * Fold the hidden relationship consequence of a resolved ceremony beat (B38/audit C1 — the 0023
   * backbone that the live loop bypassed). Engine-owned, directed, magnitudes from `CEREMONY_IMPACTS`
   * (constants only). The change lives in the hidden layer — the player feels it later as behavior,
   * never as a number (0001). Runs on every ceremony (player- AND NPC-driven).
   */
  private foldCeremonyConsequence(ev: BeatEvent): void {
    const s = this.live;
    if (!s) return;
    const rng = this.beatRng();
    const fold = (from: EntityId, to: EntityId, act: CeremonyAct): void => {
      if (from !== to) this.rel.applyDirected(from, to, CEREMONY_IMPACTS[act], rng);
    };
    switch (ev.beat) {
      case "hoh-competition": {
        const winner = ev.participants[0]; // the new HOH reads as a threat to the whole house
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
        if (s.saved && s.vetoHolder) fold(s.saved, s.vetoHolder, "veto-saved"); // gratitude bond
        if (s.replacement && s.hoh) fold(s.replacement, s.hoh, "replaced");     // betrayal-shock if trusted
        break;
      }
      case "eviction": {
        const evictee = ev.participants[0];
        if (!evictee) break;
        // The evictee resents everyone responsible for sending them out (HOH + the voters who voted to
        // evict) — the SAME set the jury manner read already captured (mannerByEvictee keys). Feeds jury.
        for (const r of Object.keys(s.mannerByEvictee?.[evictee] ?? {}) as EntityId[]) fold(evictee, r, "evicted");
        // The survivors read the departing HOH as a proven threat (they just ran a week).
        if (s.outgoingHoh) for (const h of s.active) fold(h, s.outgoingHoh, "comp-won");
        break;
      }
    }
  }

  /** A deterministic per-(week,beat) RNG so a given moment resolves the same way (and across restart). */
  private beatRng(): SeededRandom {
    const name = this.house?.player.name ?? "season";
    return new SeededRandom(hashSeed(`${name}:${this.live?.week}:${this.live?.beat}`));
  }

  advanceGame(): AdvanceView {
    if (!this.house || !this.live) return this.advanceView(null);
    let ev: BeatEvent | null = null;
    if (!this.live.pending && !this.live.finished) {
      ev = advanceBeat(this.live, this.ctx(), this.beatRng());
      this.commit(ev);
    }
    // Surface the just-resolved beat (it is player-witnessed) so the finale reveal/result beats
    // and every ceremony beat are visible in the view, not only recorded to the event store.
    return this.advanceView(ev);
  }

  submitDecision(req: SubmitDecisionReq): AdvanceView {
    // No-op unless there's a matching pending decision to resolve (idempotent + robust
    // to malformed calls — the boundary must never throw an unhandled error).
    if (!this.house || !this.live || !this.live.pending || this.live.pending.kind !== req.kind) return this.advanceView(null);
    // Reconcile the PLAYER's own eviction BEFORE the tally clears state — a player who votes out (or,
    // as final HOH at F3, personally evicts) their deal partner breaks the deal (engine-decided, 0039).
    if ((req.kind === "eviction-vote" || req.kind === "final-eviction") && req.vote) {
      this.reconcileDeals({ actor: PLAYER, kind: "vote-evict", targets: [req.vote] });
    }
    const ev = applyDecision(this.live, this.toDecisionInput(req), this.ctx());
    this.commit(ev);
    return this.advanceView(ev);
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
    const deal = this.deals.make([PLAYER, target], req.kind, terms, evId);
    this.onPersist?.();
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
    if (broken.length > 0) this.onPersist?.();
  }

  /** The binding action a resolved beat represents (for deal reconciliation). */
  private bindingActionFor(ev: BeatEvent): BindingAction | null {
    const s = this.live;
    if (!s) return null;
    switch (ev.beat) {
      case "nominations":
        return s.hoh && s.nominees ? { actor: s.hoh, kind: "nominate", targets: [...s.nominees] } : null;
      case "veto-ceremony":
        return s.hoh && s.replacement ? { actor: s.hoh, kind: "replace", targets: [s.replacement] } : null;
      default:
        return null;
    }
  }

  /** Fold a resolved beat into the public projection: record the event, reconcile deals, sync, persist. */
  private commit(ev: BeatEvent | null): void {
    if (ev) this.onEvent?.({ ...ev, content: this.humanize(ev.content) });
    // 0039: a binding ceremony beat may honor or break an open deal — let the engine adjudicate.
    if (ev) {
      const action = this.bindingActionFor(ev);
      if (action) this.reconcileDeals(action);
    }
    // 0040: at the nomination ceremony the directly-involved houseguests (HOH + nominees) privately
    // confess their REAL engine-grounded read — Vault-only (witnessed by them alone), reaching no one.
    if (ev && ev.beat === "nominations") this.recordCeremonyConfessionals();
    // 0041: the season changes a houseguest — fold the beat's emotional impact into the involved souls
    // (a comp win emboldens; a blindside rattles), evolving the hidden arc that bends their later play.
    if (ev) this.evolveFromBeat(ev);
    // B38/0023: the loop's most consequential acts (noms/veto/replacement/eviction/comp wins) move the
    // HIDDEN relationship layer — the player's action changes how the house feels about them (and each
    // other). Engine-owned, magnitudes from constants, never surfaced (the Vault Wall, 0001).
    if (ev) this.foldCeremonyConsequence(ev);
    this.syncProjection();
    this.onPersist?.();
  }

  /** Record each involved NPC's Vault-only confessional at the nomination ceremony (0040). */
  private recordCeremonyConfessionals(): void {
    const s = this.live;
    if (!s || !this.house || !this.onPlayerEvent) return;
    const everyone = [this.house.player.id, ...this.house.npcs.map((n) => n.id)];
    const involved = [s.hoh, ...(s.nominees ?? [])].filter((id): id is EntityId => !!id);
    for (const conf of involvedConfessionals(involved, everyone, this.rel)) {
      // witnessSet = [the confessing NPC] → hidden=true (the player is never a witness, 0002).
      this.onPlayerEvent(conf.content, [conf.npc], "confessional");
    }
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
      case "replacement":
        if (!req.replacement) throw new Error("a replacement nominee is required");
        return { kind: "replacement", replacement: req.replacement };
      case "eviction-vote":
        if (!req.vote) throw new Error("an eviction vote is required");
        return { kind: "eviction-vote", vote: req.vote };
      case "final-eviction": // Final 3 (0045): the final HOH evicts; `vote` carries the evictee.
        if (!req.vote) throw new Error("a final-eviction target is required");
        return { kind: "final-eviction", evict: req.vote };
      // --- finale (0037) ---
      case "finale-statement":
        return { kind: "finale-statement", statement: req.statement ?? "" };
      case "finale-answer": {
        if (!req.appeal || !(FINALE_APPEALS as readonly string[]).includes(req.appeal)) {
          throw new Error("a legal finale appeal is required");
        }
        return { kind: "finale-answer", appeal: req.appeal as FinaleAppeal };
      }
      case "juror-vote":
        if (!req.vote) throw new Error("a juror vote is required");
        return { kind: "juror-vote", vote: req.vote };
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
        return { kind: p.kind, by, prompt: "You hold the Power of Veto — use it to save a nominee, or leave the nominations.", options: refs(p.nominees), pick: 1 };
      case "replacement":
        return { kind: p.kind, by, prompt: `You used the veto on ${this.nameOf((p as { saved: EntityId }).saved)} — name a replacement nominee.`, options: refs(p.options), pick: 1 };
      case "eviction-vote":
        return { kind: p.kind, by, prompt: "Cast your vote to evict one of the two nominees.", options: refs(p.nominees), pick: 1 };
      case "final-eviction":
        return { kind: p.kind, by, prompt: "You are the final Head of Household — evict one houseguest; the other sits beside you at the Final 2.", options: refs(p.options), pick: 1 };
      // --- finale (0037) ---
      case "finale-statement":
        return { kind: p.kind, by, prompt: "You are a finalist — give your opening statement to the jury.", options: [], pick: 0 };
      case "finale-answer":
        return {
          kind: p.kind, by,
          prompt: `${this.nameOf(p.juror)} asks you a question — choose how you make your case.`,
          options: [], appeals: [...p.appeals], juror: this.named(p.juror)!, pick: 1,
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
    };
  }

  /**
   * Vault-free projection of an in-progress finale (0037): names, the current stage, the
   * juror asking, and the votes REVEALED SO FAR (`revealIx`) only. No lean, no tally, no
   * manner, and no pre-reveal winner ever crosses — a juror's vote appears only after it is
   * revealed in order. Null unless the finale is actively staging.
   */
  private finaleView(): FinaleView | null {
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

  /** Replace raw entity ids in a loop event string with the houseguests' public names. */
  private humanize(content: string): string {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    let out = content;
    // Longest ids first so "npc:1" never clobbers part of "npc:15".
    for (const h of [...all].sort((a, b) => b.id.length - a.id.length)) {
      out = out.split(h.id).join(h.name);
    }
    return out;
  }

  getGameState(): GameStateView {
    return this.view();
  }

  getMomentPrompt(req: MomentPromptReq): MomentPromptView {
    const view = this.view();
    const moment = req.moment ?? view.moment;
    return { moment, systemPrompt: buildSystemPrompt(moment, view) };
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
      if (peek) return { started: true, type: peek.type, week: this.week, phase: this.phase, winner: this.named(peek.winner) };
      // Between competitions: report the most recently crowned comp from public ceremony state — no re-roll.
      const last = this.ceremony.vetoHolder ?? this.ceremony.hoh;
      return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: last ? this.named(last) : null };
    }
    return { started: true, type: fallbackType, week: this.week, phase: this.phase, winner: null };
  }

  /** The Vault-free projection. Player card = authored persona (no numeric stats); NPCs = name + status only. */
  private view(): GameStateView {
    if (!this.house) {
      return { started: false, week: 0, phase: this.phase, moment: "character-creation", player: null, house: [] };
    }
    const p = this.house.player;
    return {
      started: true,
      week: this.week,
      phase: this.phase,
      moment: momentForPhase(this.phase),
      player: {
        id: p.id,
        name: p.name,
        // Surface the player's OWN words (what they typed at OOBE) so the narrative voices them as
        // described; fall back to the canonical labels. Stats stay hidden behind the Vault either way.
        archetype: p.persona?.archetype ?? p.character.archetype,
        strategyStyle: p.persona?.strategyStyle ?? p.character.strategyStyle,
      },
      house: this.house.npcs.map((n) => ({
        id: n.id, name: n.name,
        status: this.live?.evictionOrder.includes(n.id) ? "evicted" : "active",
      })),
      // Deals the player is party to (0039) — fact + status only; NPC↔NPC deals never appear here.
      deals: this.deals.forParty(PLAYER).map((d) => this.dealView(d)),
    };
  }
}
