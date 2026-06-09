import type {
  GameSession, CreateCharacterReq, GameStateView, MomentPromptReq, MomentPromptView,
  RunCompetitionReq, CompetitionResultView, PublicGameStatus,
  AdvanceView, SubmitDecisionReq, PendingDecisionView, NamedRef, SocialInitiative, PlayerTaglineView,
  FinaleView, MakeDealReq, DealView,
} from "../../ports/GameSession";
import { DealLedger } from "../../engine/deals";
import type { BindingAction, Deal } from "../../engine/deals";
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
import type { GameHouse, StrategyStyle } from "../../engine/characterFactory";
import { buildSystemPrompt, momentForPhase } from "../../engine/momentPrompts";
import { resolveCompetition, CompetitionIntents } from "../../domain/competitionOutcome";
import type { CompetitionType, Competitor } from "../../domain/competitionOutcome";
import { SeededRandom } from "../random/SeededRandom";
import { PLAYER } from "../../domain/ids";
import type { EntityId } from "../../domain/ids";
import { RelationshipModel } from "../../engine/relationships";
import type { Stats } from "../../engine/season";
import {
  newLiveSeason, advance as advanceBeat, applyDecision, recordDealBetrayal, type LiveSeasonState,
  type SeasonCtx, type BeatEvent, type DecisionInput, type PendingDecision,
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

  /** Build the Vault-free season context the pure loop reads (stats + live relationships). */
  private ctx(): SeasonCtx {
    return { player: PLAYER, statsOf: (id) => this.statsOf(id), rel: this.rel };
  }

  private statsOf(id: EntityId): Stats {
    const all = this.house ? [this.house.player, ...this.house.npcs] : [];
    return all.find((h) => h.id === id)?.character.stats ?? { physical: 0.5, mental: 0.5, social: 0.5 };
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
    // Reconcile the PLAYER's own eviction vote against open deals BEFORE the tally clears state —
    // a player who votes out their deal partner breaks it (engine-decided, 0039).
    if (req.kind === "eviction-vote" && req.vote) {
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
    this.syncProjection();
    this.onPersist?.();
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

  runCompetition(req: RunCompetitionReq): CompetitionResultView {
    const type = (COMP_TYPES.has(req.type ?? "") ? req.type : "endurance") as CompetitionType;
    if (!this.house) {
      return { started: false, type, week: 0, phase: this.phase, winner: null };
    }
    // The whole house competes by default; the engine reads its OWN stats (never the caller's).
    const all = [this.house.player, ...this.house.npcs];
    const ids = req.participantIds?.length ? new Set(req.participantIds) : null;
    const pool = ids ? all.filter((h) => ids.has(h.id)) : all;
    const field = pool.length >= 2 ? pool : all;
    const competitors: Competitor[] = field.map((h) => ({
      id: h.id,
      stats: h.character.stats,
      emotionalState: "soul" in h ? h.soul.emotionalState : 0.5,
    }));
    // Deterministic per moment so a given week/phase/type resolves the same way.
    const rng = new SeededRandom(hashSeed(`${this.week}:${this.phase}:${type}`));
    const { winner } = resolveCompetition(competitors, type, new CompetitionIntents(), rng);
    const w = field.find((h) => h.id === winner)!;
    return { started: true, type, week: this.week, phase: this.phase, winner: { id: w.id, name: w.name } };
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
