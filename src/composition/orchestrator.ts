import type { GameSessionRegistry, UserSandbox } from "./registry";
import type { Clock } from "../ports/Clock";
import type { SessionSnapshot } from "../engine/sessionSnapshot";
import { toGameState } from "../engine/sessionSnapshot";
import { counts, isSuperset, countsNonDecreasing } from "../domain/saveState";
import { richOffscreenStretch } from "../engine/offscreen";
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
}

export interface AdvanceResult {
  events: number;
  integrity: "ok" | "fault";
  faults: Fault[];
}

export interface OrchestratorConfig {
  seed?: number;
  offscreenInteractions?: number;
  /** Test seam: override the state-mutating step (off-screen + day). Default = the real one. */
  apply?: (sandbox: UserSandbox, trigger: Trigger, rng: SeededRandom, clockNow: number) => number;
}

export class Orchestrator {
  private readonly seed: number;
  private readonly offscreenInteractions: number;
  private readonly applyFn: NonNullable<OrchestratorConfig["apply"]>;
  private readonly rngs = new Map<string, SeededRandom>();
  private readonly health = new Map<string, HealthRecord>();
  private readonly lastActivity = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly registry: GameSessionRegistry,
    private readonly clock: Clock,
    cfg: OrchestratorConfig = {},
  ) {
    this.seed = cfg.seed ?? 1;
    this.offscreenInteractions = cfg.offscreenInteractions ?? 2;
    this.applyFn = cfg.apply ?? defaultApply;
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

  /** Wall time of the user's last player activity (−∞ if never active ⇒ eligible for idle ticks). */
  idleSince(user: string): number {
    return this.lastActivity.has(user) ? this.lastActivity.get(user)! : -Infinity;
  }

  /** The one advance spine. `audit` verifies only (no progression). */
  advance(user: string, trigger: Trigger): AdvanceResult {
    const sandbox = this.registry.sandboxFor(user);
    const baseline = this.registry.snapshot(user);

    let produced = 0;
    if (trigger !== "audit") {
      produced = this.applyFn(sandbox, trigger, this.rngFor(user), this.clock.now());
    }

    const candidate = this.registry.snapshot(user);
    const faults = this.checkpoint(baseline, candidate, sandbox, trigger);
    const when = this.clock.now();

    if (faults.length === 0) {
      if (trigger !== "audit") this.registry.saveUser(user);
      if (trigger === "player-turn") this.touch(user);
      this.recordHealth(user, this.registry.sandboxFor(user), trigger, when, "ok");
      return { events: produced, integrity: "ok", faults: [] };
    }

    // Fail-closed: roll the in-memory sandbox back to the baseline (clean rebuild,
    // no aborted events left behind) and DO NOT persist. The prior save is intact.
    if (trigger !== "audit") this.registry.restore(user, baseline);
    const prior = this.health.get(user);
    const allFaults = [...(prior?.faults ?? []), ...faults];
    this.recordHealth(user, this.registry.sandboxFor(user), trigger, when, "fault", allFaults);
    return { events: 0, integrity: "fault", faults };
  }

  /** Verify a candidate advance against the baseline — fail-closed (0031 §4.3). */
  checkpoint(
    baseline: SessionSnapshot,
    candidate: SessionSnapshot,
    sandbox: UserSandbox,
    trigger: Trigger = "player-turn",
  ): Fault[] {
    const faults: Fault[] = [];
    const when = this.clock.now();
    const gsBase = toGameState(baseline);
    const gsCand = toGameState(candidate);

    // Non-degradation (0007): nothing previously persisted may be dropped.
    if (!isSuperset(gsCand, gsBase) || !countsNonDecreasing(counts(gsCand), counts(gsBase))) {
      faults.push({ when, kind: "degradation" });
    }
    // Daily-event (0008): a progression advance must produce ≥1 new event.
    if (trigger !== "audit" && counts(gsCand).events <= counts(gsBase).events) {
      faults.push({ when, kind: "no-daily-event" });
    }
    // Vault Wall (0001): no hidden event's content may appear in the player projection.
    const hidden = candidate.events.filter((e) => e.hidden).map((e) => e.content);
    if (hidden.length > 0) {
      const view = playerSweep(sandbox);
      if (hidden.some((c) => c && view.includes(c))) faults.push({ when, kind: "vault-leak" });
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
    };
  }
}

/** The default state-mutating step: a varied off-screen society + (player-turn) a witnessed day. */
function defaultApply(sandbox: UserSandbox, trigger: Trigger, rng: SeededRandom, clockNow: number): number {
  const core = sandbox.session.snapshot();
  const npcs: EntityId[] = (core.house?.npcs ?? []).map((n) => n.id);
  const ids = npcs.length >= 2 ? npcs : [npc(1), npc(2), npc(3), npc(4)];
  const before = sandbox.engine.events.query().length;

  // Off-screen society (0038): the house lives in MORE than one way — varied typed scenes the
  // player never witnesses (hidden; 0003), each folded with its REAL interaction nature (0023).
  const scenes = richOffscreenStretch({ events: sandbox.engine.events, rng, npcs: ids, interactions: 3 });
  for (const s of scenes) {
    sandbox.engine.relationships.applyDirected(s.partner, s.initiator, s.type, rng);
    // 0041 (the linchpin pays off): the scene also deepens the initiator's soul — their arc accrues
    // and their mood drifts by the scene's nature, so the house's souls evolve BETWEEN turns (0038).
    sandbox.session.recordOffscreenSoul(s.initiator, s.type);
  }

  // NPC interiority (0040): an involved houseguest privately confesses their REAL read — Vault-only
  // (witnessed by them alone), grounded in their actual relationship signals, never invented. It
  // reaches no one (player or admin); the player feels it only later through that NPC's behavior.
  if (scenes.length > 0) {
    const confessor = scenes[rng.int(scenes.length)]!.initiator;
    recordConfessional(sandbox.engine.events, confessionalFor(confessor, ids, sandbox.engine.relationships), rng, clockNow);
  }

  if (trigger === "player-turn") {
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
