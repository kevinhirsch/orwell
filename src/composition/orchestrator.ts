import type { GameSessionRegistry, UserSandbox } from "./registry";
import type { Clock } from "../ports/Clock";
import type { SessionSnapshot } from "../engine/sessionSnapshot";
import { toGameState } from "../engine/sessionSnapshot";
import { counts, isSuperset, countsNonDecreasing } from "../domain/saveState";
import { richOffscreenStretch } from "../engine/offscreen";
import { rollOverhears } from "../engine/presence";
import { diffuseGossip, makeSocialGraph, rumorFrom, GOSSIP } from "../engine/gossip";
import { confessionalFor, recordConfessional } from "../engine/confessionals";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed } from "../engine/characterFactory";
import { PLAYER, npc } from "../domain/ids";
import type { EntityId } from "../domain/ids";

/**
 * Per-sandbox game orchestrator (feature 0031). The SINGLE path that moves a game:
 *
 *   advance() → off-screen NPC tick → (player-turn) a meaningful scheduled day →
 *              consequence fold → integrity checkpoint (fail-closed) → persist.
 *
 * Pure-logic and seed-deterministic: identical seed + identical trigger sequence
 * ⇒ identical state. The background watcher (gameWatcher.ts) only *triggers* this
 * and *reads* health — it holds no game logic, so a fake clock makes the whole
 * supervised loop deterministic. The checkpoint is fail-closed: an advance that
 * would drop persisted detail or leak hidden state is refused, the prior save is
 * left intact, and a fault is recorded — never a degraded/leaky commit (mandate #4).
 */
export type Trigger = "player-turn" | "offscreen-tick" | "audit";

export interface Fault {
  when: number;
  kind: "degradation" | "no-daily-event" | "vault-leak";
}

/** Vault-free health metadata for God Mode (0016) — never game content, never Vault. */
export interface HealthRecord {
  user: string;
  started: boolean;
  week: number;
  phase: string;
  lastAdvanceAt: number | null;
  lastTrigger: Trigger | null;
  eventCount: number;
  lastIntegrity: "ok" | "fault";
  faults: Fault[];
  /**
   * The circuit breaker (B58/audit E6): true after `BREAKER_THRESHOLD` consecutive faults — the
   * watcher's off-screen ticks SKIP this sandbox (no identical blind retries) until a successful
   * player-turn commit closes the circuit again.
   */
  circuitOpen: boolean;
}

export interface AdvanceResult {
  events: number;
  integrity: "ok" | "fault";
  faults: Fault[];
}

export interface OrchestratorConfig {
  seed?: number;
  /** Off-screen scenes per tick (B59 — finally a REAL knob; previously hard-coded in the apply step). */
  offscreenInteractions?: number;
  /** Test seam: override the state-mutating step (off-screen + day). Default = the real one. */
  apply?: (sandbox: UserSandbox, trigger: Trigger, rng: SeededRandom, clockNow: number, interactions?: number) => number;
  /**
   * Pure turn-driven mode (the watcher is disabled, `tickEveryMs:0`): the house can't live between
   * wakes, so every player turn fires ONE bounded off-screen tick (B41/audit D4/M6). Default false.
   */
  turnDriven?: boolean;
}

export class Orchestrator {
  /** Consecutive faults that OPEN the circuit (off-screen ticks skip the sandbox). B58/E6. */
  private static readonly BREAKER_THRESHOLD = 3;
  /** Stored-fault cap per sandbox — health keeps the most recent, never an unbounded log. */
  private static readonly MAX_STORED_FAULTS = 20;

  private readonly seed: number;
  private readonly offscreenInteractions: number;
  private readonly applyFn: NonNullable<OrchestratorConfig["apply"]>;
  private readonly turnDriven: boolean;
  private readonly rngs = new Map<string, SeededRandom>();
  private readonly health = new Map<string, HealthRecord>();
  private readonly lastActivity = new Map<string, number>();
  /** Consecutive integrity faults per user (any success resets it). B58/E6. */
  private readonly consecutiveFaults = new Map<string, number>();
  /** The last GOOD persisted state per user — the baseline a player-turn commit checks against (B41). */
  private readonly baselines = new Map<string, SessionSnapshot>();
  private seq = 0;

  constructor(
    private readonly registry: GameSessionRegistry,
    private readonly clock: Clock,
    cfg: OrchestratorConfig = {},
  ) {
    this.seed = cfg.seed ?? 1;
    this.offscreenInteractions = cfg.offscreenInteractions ?? 3; // matches the long-standing live cadence
    this.applyFn = cfg.apply ?? defaultApply;
    this.turnDriven = cfg.turnDriven ?? false;
  }

  /** Per-user deterministic RNG stream (seed + user), created once and advanced across ticks. */
  private rngFor(user: string): SeededRandom {
    let r = this.rngs.get(user);
    if (!r) {
      r = new SeededRandom(hashSeed(`${this.seed}:${user}`));
      this.rngs.set(user, r);
    }
    return r;
  }

  /** Mark a player-driven moment of activity (resets the idle clock for the watcher). */
  touch(user: string): void {
    this.lastActivity.set(user, this.clock.now());
  }

  /**
   * Wall time of the user's last player activity. A user who has NEVER taken a turn is treated as
   * NOT-yet-idle (B41/audit D4) — `+Infinity`, so the watcher's idle gate (`now - idleSince ≥ …`) is
   * false and they accrue no off-screen ticks until they've actually played and then gone away. (The
   * old `−Infinity` made every never-touched user permanently "idle" ⇒ the off-screen flood.)
   */
  idleSince(user: string): number {
    return this.lastActivity.has(user) ? this.lastActivity.get(user)! : Infinity;
  }

  /** Is the user's circuit open (B58/E6)? Off-screen ticks skip; a good player turn closes it. */
  private circuitOpen(user: string): boolean {
    return (this.consecutiveFaults.get(user) ?? 0) >= Orchestrator.BREAKER_THRESHOLD;
  }

  /** How many LIVING NPCs the off-screen society can draw on (B52: evictees stop living).
   *  No live game ⇒ the synthetic test pool — always enough. */
  private offscreenPoolSize(user: string): number {
    const core = this.registry.sandboxFor(user).session.snapshot();
    if (!core.house) return Infinity;
    const evicted = new Set(core.live?.evictionOrder ?? []);
    return core.house.npcs.filter((n) => !evicted.has(n.id)).length;
  }

  /** Surface a fault where an operator can see it (B58/E6) — stderr, with user + kinds. */
  private logFaults(user: string, trigger: Trigger, faults: Fault[]): void {
    console.error(
      `[orwell] integrity fault user=${user} trigger=${trigger} kinds=${faults.map((f) => f.kind).join(",")}` +
      (this.circuitOpen(user) ? " circuit=OPEN" : ""),
    );
  }

  /** The one advance spine. `audit` verifies only (no progression). */
  advance(user: string, trigger: Trigger): AdvanceResult {
    // The circuit breaker (B58/E6): after repeated identical faults, off-screen ticks SKIP this
    // sandbox instead of blindly retrying — the flag shows in health; a good player turn resets it.
    if (trigger === "offscreen-tick" && this.circuitOpen(user)) {
      return { events: 0, integrity: "fault", faults: this.health.get(user)?.faults.slice(-1) ?? [] };
    }
    // Deep endgame (0044 follow-through of the B52 rule): with fewer than two LIVING NPCs there is
    // no off-screen society left to run — e.g. the player standing in the Final 2. That tick is a
    // clean no-op, NOT an integrity fault: the daily-event invariant belongs to the live loop's own
    // beats (the finale is full of them), and flagging the empty house would log a false fault on
    // every finale turn of a healthy, player-won game.
    if (trigger === "offscreen-tick" && this.offscreenPoolSize(user) < 2) {
      return { events: 0, integrity: "ok", faults: [] };
    }
    const sandbox = this.registry.sandboxFor(user);
    const baseline = this.registry.snapshot(user);

    let produced = 0;
    if (trigger !== "audit") {
      produced = this.applyFn(sandbox, trigger, this.rngFor(user), this.clock.now(), this.offscreenInteractions);
    }

    const candidate = this.registry.snapshot(user);
    const faults = this.checkpoint(baseline, candidate, sandbox, trigger);
    const when = this.clock.now();

    if (faults.length === 0) {
      this.consecutiveFaults.set(user, 0); // any clean advance closes the circuit
      if (trigger !== "audit") { this.registry.saveUser(user); this.baselines.set(user, candidate); }
      if (trigger === "player-turn") this.touch(user);
      this.recordHealth(user, this.registry.sandboxFor(user), trigger, when, "ok");
      return { events: produced, integrity: "ok", faults: [] };
    }

    // Fail-closed: roll the in-memory sandbox back to the baseline (clean rebuild,
    // no aborted events left behind) and DO NOT persist. The prior save is intact.
    if (trigger !== "audit") this.registry.restore(user, baseline);
    this.consecutiveFaults.set(user, (this.consecutiveFaults.get(user) ?? 0) + 1);
    this.logFaults(user, trigger, faults);
    const prior = this.health.get(user);
    const allFaults = [...(prior?.faults ?? []), ...faults].slice(-Orchestrator.MAX_STORED_FAULTS);
    this.recordHealth(user, this.registry.sandboxFor(user), trigger, when, "fault", allFaults);
    return { events: 0, integrity: "fault", faults };
  }

  /**
   * The player-turn commit (B41/audit E3) — the orchestrator becomes the real spine. The registry
   * routes its save-on-mutation `onPersist` here, so EVERY player mutation now runs the fail-closed
   * integrity checkpoint instead of persisting blindly: a leaky/degrading commit is rolled back and
   * NOT saved (mandate #4). It also `touch`es the user (so the watcher's idle gate stops flooding
   * off-screen ticks mid-scene) and, in pure turn-driven mode, fires ONE bounded off-screen tick so
   * the house still lives turn-to-turn without the watcher.
   */
  commitPlayerTurn(user: string): void {
    const sandbox = this.registry.sandboxFor(user);
    const candidate = this.registry.snapshot(user);
    const when = this.clock.now();
    const baseline = this.baselines.get(user);

    // The first commit (e.g. createCharacter) has no prior good state — accept it and establish the
    // baseline; there is nothing to degrade away from.
    const faults = baseline ? this.checkpoint(baseline, candidate, sandbox, "player-turn", { requireDailyEvent: false }) : [];

    if (faults.length === 0) {
      this.consecutiveFaults.set(user, 0); // a good player turn closes the circuit (B58/E6)
      this.registry.saveUser(user);
      this.baselines.set(user, candidate);
      this.touch(user);
      this.maybeTurnDrivenTick(user);            // may record an offscreen-tick health entry…
      this.recordHealth(user, this.registry.sandboxFor(user), "player-turn", when, "ok"); // …player-turn has the last word
      return;
    }
    // Fail-closed: roll the in-memory sandbox back to the last good state and DO NOT persist.
    this.registry.restore(user, baseline!);
    this.consecutiveFaults.set(user, (this.consecutiveFaults.get(user) ?? 0) + 1);
    this.logFaults(user, "player-turn", faults);
    const prior = this.health.get(user);
    this.recordHealth(user, this.registry.sandboxFor(user), "player-turn", when, "fault",
      [...(prior?.faults ?? []), ...faults].slice(-Orchestrator.MAX_STORED_FAULTS));
  }

  /** In pure turn-driven mode, advance one bounded off-screen tick so the house lives between turns (B41). */
  private maybeTurnDrivenTick(user: string): void {
    if (this.turnDriven) this.advance(user, "offscreen-tick");
  }

  /** Verify a candidate advance against the baseline — fail-closed (0031 §4.3). */
  checkpoint(
    baseline: SessionSnapshot,
    candidate: SessionSnapshot,
    sandbox: UserSandbox,
    trigger: Trigger = "player-turn",
    opts: { requireDailyEvent?: boolean } = {},
  ): Fault[] {
    const faults: Fault[] = [];
    const when = this.clock.now();
    const gsBase = toGameState(baseline);
    const gsCand = toGameState(candidate);

    // Non-degradation (0007): nothing previously persisted may be dropped.
    if (!isSuperset(gsCand, gsBase) || !countsNonDecreasing(counts(gsCand), counts(gsBase))) {
      faults.push({ when, kind: "degradation" });
    }
    // Daily-event (0008): a progression advance must produce ≥1 new event. A player-turn COMMIT
    // (B41) opts out — not every player tool call adds a beat (a deal, a surfacing, a DR entry).
    const requireDailyEvent = opts.requireDailyEvent ?? trigger !== "audit";
    if (requireDailyEvent && counts(gsCand).events <= counts(gsBase).events) {
      faults.push({ when, kind: "no-daily-event" });
    }
    // Vault Wall (0001): no hidden event's content may appear in the player projection — UNLESS the
    // player legitimately holds it through a real pathway (B27b: gossip/overhears/tellings surface
    // sanctioned, traceable beliefs; flagging those would refuse every legal propagation). The 0001
    // sentinel canary remains the precise guard for content with NO pathway to the player.
    const hidden = candidate.events.filter((e) => e.hidden).map((e) => e.content);
    if (hidden.length > 0) {
      const view = playerSweep(sandbox);
      const playerFacts = (candidate.knowledge?.knowledge?.[PLAYER] ?? [])
        .filter((f) => /^(told-by:|overheard:|gossip|surfaced)/.test(f.pathway))
        .map((f) => f.content);
      const sanctioned = (c: string): boolean => playerFacts.some((f) => f.includes(c));
      if (hidden.some((c) => c && view.includes(c) && !sanctioned(c))) faults.push({ when, kind: "vault-leak" });
    }
    return faults;
  }

  private recordHealth(
    user: string,
    sandbox: UserSandbox,
    trigger: Trigger,
    when: number,
    integrity: "ok" | "fault",
    faults: Fault[] = [],
  ): void {
    const core = sandbox.session.snapshot();
    this.health.set(user, {
      user,
      started: core.started,
      week: core.week,
      phase: core.phase,
      lastAdvanceAt: when,
      lastTrigger: trigger,
      eventCount: sandbox.engine.events.query().length,
      lastIntegrity: integrity,
      faults,
      circuitOpen: this.circuitOpen(user),
    });
  }

  /** Vault-free health metadata for God Mode (0016). Per-user, or all sandboxes. */
  sandboxHealth(user?: string): HealthRecord | HealthRecord[] {
    if (user !== undefined) {
      return this.health.get(user) ?? this.freshHealth(user);
    }
    return this.registry.usernames().map((u) => this.health.get(u) ?? this.freshHealth(u));
  }

  private freshHealth(user: string): HealthRecord {
    const core = this.registry.sandboxFor(user).session.snapshot();
    return {
      user,
      started: core.started,
      week: core.week,
      phase: core.phase,
      lastAdvanceAt: null,
      lastTrigger: null,
      eventCount: this.registry.sandboxFor(user).engine.events.query().length,
      lastIntegrity: "ok",
      faults: [],
      circuitOpen: false,
    };
  }
}

/** The default state-mutating step: a varied off-screen society + (player-turn) a witnessed day. */
function defaultApply(sandbox: UserSandbox, trigger: Trigger, rng: SeededRandom, clockNow: number, interactions = 3): number {
  const core = sandbox.session.snapshot();
  // B52/audit D5: evicted houseguests stop living — they leave the off-screen society the moment they
  // go (no more scheming/confessing weeks after eviction). A real house ⇒ only the LIVING NPCs; with no
  // live game (tests/edge) ⇒ a small synthetic pool. The fallback never resurrects a real evictee.
  const evicted = new Set(core.live?.evictionOrder ?? []);
  const activeNpcs = (core.house?.npcs ?? []).filter((n) => !evicted.has(n.id)).map((n) => n.id);
  const ids = core.house ? activeNpcs : [npc(1), npc(2), npc(3), npc(4)];
  const before = sandbox.engine.events.query().length;

  // House presence (0049): the tick re-seats the house FIRST (seeded, affinity-clustered, adjacent
  // moves only), so this stretch's scenes happen somewhere and overhears have ground truth.
  sandbox.session.presenceTick(rng);
  const occupancy = sandbox.session.occupancy();

  // Off-screen society (0038): the house lives in MORE than one way — varied typed scenes the
  // player never witnesses (hidden; 0003), each folded with its REAL interaction nature (0023). A
  // houseguest's hidden element (B50) rarely slips into a scene's hidden content (rare-reveal loop).
  const hiddenOf = new Map((core.house?.npcs ?? []).map((n) => [n.id, n.character.hiddenElements]));
  const scenes = ids.length >= 2
    ? richOffscreenStretch({
        events: sandbox.engine.events, rng, npcs: ids, interactions,
        hiddenElementsOf: (id) => hiddenOf.get(id) ?? [],
      })
    : []; // too few living NPCs to pair (deep endgame) — no off-screen society
  for (const s of scenes) {
    sandbox.engine.relationships.applyDirected(s.partner, s.initiator, s.type, rng);
    // 0041 (the linchpin pays off): the scene also deepens the initiator's soul — their arc accrues
    // and their mood drifts by the scene's nature, so the house's souls evolve BETWEEN turns (0038).
    sandbox.session.recordOffscreenSoul(s.initiator, s.type);
    // 0049: the scene happens WHERE its initiator is; anyone one room over — INCLUDING the player —
    // may catch a piece of it. A successful roll is a real, traceable `overheard:` pathway (0002),
    // partial and lower-confidence: eavesdropping is information-gathering, never narrative vibes.
    const room = occupancy?.get(s.initiator);
    if (occupancy && room) {
      rollOverhears({
        eventId: s.event.id, room, content: s.event.content, participants: s.event.witnessSet,
        occupancy, knowledge: sandbox.engine.knowledge, rng,
      });
    }
  }

  // B27b — live gossip: occasionally one of the night's scenes becomes a RUMOR that diffuses along
  // the affinity graph (who actually talks to whom), with low per-edge transmission, decaying
  // confidence, and per-telling drift. The PLAYER is a node like anyone: a chain that terminates at
  // them lands the belief — a vague paraphrase with source+confidence, never the verbatim hidden
  // scene and never a number. Every retelling is a recorded, traceable event (0002).
  if (core.house && scenes.length > 0 && rng.next() < GOSSIP.riseProb) {
    const scene = scenes[rng.int(scenes.length)]!;
    const everyone: EntityId[] = [core.house.player.id, ...activeNpcs];
    const edges: Array<readonly [EntityId, EntityId]> = [];
    for (let i = 0; i < everyone.length; i++) {
      for (let j = i + 1; j < everyone.length; j++) {
        if (sandbox.engine.relationships.edge(everyone[i]!, everyone[j]!).affinity > GOSSIP.affinityEdge) {
          edges.push([everyone[i]!, everyone[j]!] as const);
        }
      }
    }
    if (edges.length > 0) {
      diffuseGossip({
        knowledge: sandbox.engine.knowledge,
        graph: makeSocialGraph(edges),
        rng,
        origin: scene.initiator,
        fact: { content: rumorFrom(scene.initiator, scene.partner, scene.type) },
        rounds: GOSSIP.rounds,
        transmitProb: GOSSIP.transmitProb,
        decay: GOSSIP.decay,
      });
    }
  }

  // NPC interiority (0040): an involved houseguest privately confesses their REAL read — Vault-only
  // (witnessed by them alone), grounded in their actual relationship signals, never invented. It
  // reaches no one (player or admin); the player feels it only later through that NPC's behavior.
  if (scenes.length > 0) {
    const confessor = scenes[rng.int(scenes.length)]!.initiator;
    recordConfessional(sandbox.engine.events, confessionalFor(confessor, ids, sandbox.engine.relationships), rng, clockNow);
  }

  if (trigger === "player-turn" && ids.length > 0) {
    // A meaningful, player-witnessed day event (daily-event invariant, 0008).
    sandbox.engine.events.record({
      id: `orch:day:${clockNow}:${rng.int(1_000_000_000)}`,
      ts: clockNow,
      type: "house-event",
      initiator: ids[0]!,
      witnessSet: [PLAYER, ids[0]!],
      hidden: false,
      content: "A house meeting shifts the week.",
    });
  }
  // Every recorded scene (+ the player-turn day) counts toward the advance.
  return sandbox.engine.events.query().length - before;
}

function playerSweep(sandbox: UserSandbox): string {
  const p = sandbox.player;
  return [
    p.produce("player-visible log"),
    p.produce("scene narration"),
    JSON.stringify(p.assembleNarrationContext("scene")),
    JSON.stringify(p.getVisibleState()),
  ].join("\n---\n");
}
