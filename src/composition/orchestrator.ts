import type { GameSessionRegistry, UserSandbox } from "./registry";
import type { Clock } from "../ports/Clock";
import type { SessionSnapshot } from "../engine/sessionSnapshot";
import { toGameState, sessionCoreCounts, sessionCoreCountsNonDecreasing, sessionCoreIsSuperset } from "../engine/sessionSnapshot";
import { counts, isSuperset, countsNonDecreasing } from "../domain/saveState";
import { richOffscreenStretch } from "../engine/offscreen";
import { scaleImpact, natureFoldImpact } from "../engine/relationshipConstants";
import { rollOverhears } from "../engine/presence";
import { diffuseGossip, makeSocialGraph, rumorFrom, gossipEdgeAffinity, GOSSIP } from "../engine/gossip";
import { confessionalFor, recordConfessional, selectRecentForConfessional } from "../engine/confessionals";
import { nextHouseEvent, dayOfWeek } from "../engine/houseEvents";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed } from "../engine/characterFactory";
import { PLAYER } from "../domain/ids";
import type { EntityId } from "../domain/ids";
import { TurnRefusedError, PersistFailureError } from "../domain/errors";

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
  /** `persist-failure` is its OWN class (audit E7): a disk failure is never misread as degradation. */
  kind: "degradation" | "no-daily-event" | "vault-leak" | "persist-failure";
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
  /**
   * Auxiliary-commit tick debounce (audit E57/R5): a beat commit (the live loop moved) always earns
   * its tick, but auxiliary tool calls inside the SAME player turn (recordInteraction + diaryRoom +
   * a read…) must not each fire one — one bounded tick per player TURN, not per tool call. An aux
   * commit ticks only when this much wall time has passed since the user's last turn tick.
   */
  auxTickDebounceMs?: number;
}

export class Orchestrator {
  /** Consecutive faults that OPEN the circuit (off-screen ticks skip the sandbox). B58/E6. */
  private static readonly BREAKER_THRESHOLD = 3;
  /** Stored-fault cap per sandbox — health keeps the most recent, never an unbounded log. */
  private static readonly MAX_STORED_FAULTS = 20;
  /** Default aux-commit tick debounce (E57/R5): tool calls inside one turn land within seconds. */
  private static readonly AUX_TICK_DEBOUNCE_MS = 10_000;
  /** R3 — re-run a FULL (untrusted-prefix) event-content re-scan at least this often, per user, as cheap
   *  belt-and-suspenders; between full checks the immutable append-only event prefix is trusted (O(Δ)).
   *  Not a standalone integrity guarantee — see `trustEventPrefixFor` for what every commit still proves. */
  private static readonly R3_FULL_CHECK_EVERY = 32;

  private readonly seed: number;
  private readonly offscreenInteractions: number;
  private readonly applyFn: NonNullable<OrchestratorConfig["apply"]>;
  private readonly turnDriven: boolean;
  private readonly auxTickDebounceMs: number;
  private readonly rngs = new Map<string, SeededRandom>();
  private readonly health = new Map<string, HealthRecord>();
  private readonly lastActivity = new Map<string, number>();
  /** Consecutive integrity faults per user (any success resets it). B58/E6. */
  private readonly consecutiveFaults = new Map<string, number>();
  /** The last GOOD persisted state per user — the baseline a player-turn commit checks against (B41). */
  private readonly baselines = new Map<string, SessionSnapshot>();
  /** Wall time of the user's last turn-driven off-screen tick (the E57 debounce anchor). */
  private readonly lastTurnTickAt = new Map<string, number>();
  /** R3 — commits since this user's last FULL (untrusted-prefix) non-degradation verification. */
  private readonly commitsSinceFullCheck = new Map<string, number>();
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
    this.auxTickDebounceMs = cfg.auxTickDebounceMs ?? Orchestrator.AUX_TICK_DEBOUNCE_MS;
  }

  /**
   * Drop every per-user trace of a DEAD season (audit E1/D1/R1) — baselines, faults, health, rng
   * stream, idle/tick clocks. Wired as the registry's `onReset` hook, so the ONE sanctioned restart
   * door (`registry.resetUser` — reached by the admin reset AND by a confirmed player-channel
   * `createCharacter` restart) invalidates the old season's non-degradation baseline. Without this,
   * season 2's first commit reads as a count regression against the finished season ⇒ a degradation
   * fault on every turn, nothing persists, and the dead season resurrects on engine restart.
   */
  forgetUser(user: string): void {
    this.baselines.delete(user);
    this.health.delete(user);
    this.rngs.delete(user);
    this.lastActivity.delete(user);
    this.consecutiveFaults.delete(user);
    this.lastTurnTickAt.delete(user);
  }

  /**
   * Seed the non-degradation baseline from the user's CURRENT (just-resumed) state (audit E6).
   * Called by the runtime's boot preload: without it, the first commit after an engine restart was
   * checkpoint-blind — the guard had a hole exactly at resume-from-disk, where the historical
   * memory-thinning bug lived.
   *
   * R3 (incremental-snapshot cache): a re-baseline runs precisely BECAUSE the live session state was
   * just set/replaced from OUTSIDE the `commit` seam — a resume-from-disk, or a `session.restore` that
   * swaps a field (e.g. the 0062 world snapshot) WITHOUT appending an event. Such a mutation bumps
   * neither the registry's snapshot rev nor the event count, so a cached export can be STALE relative to
   * the live truth. The baseline must be the current state, never a point-in-time capture from before the
   * external mutation — so invalidate the cache first and read fresh (the same `invalidateSnapshot`
   * discipline `advance` uses after its off-screen `applyFn`). Without this the checkpoint compares a
   * stale baseline to the freshly-mutated candidate and wrongly refuses the next turn as degradation.
   */
  seedBaseline(user: string): void {
    this.registry.invalidateSnapshot(user);
    this.baselines.set(user, this.registry.snapshot(user));
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
   *  No started game ⇒ ZERO (audit E2): the pre-game interview has no house to scheme in — an
   *  off-screen tick before move-in would fabricate hidden history with houseguests that don't
   *  exist yet (and non-degradation would forbid ever deleting it). */
  private offscreenPoolSize(user: string): number {
    const core = this.registry.sandboxFor(user).session.snapshot();
    if (!core.started || !core.house) return 0;
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

  /** The one advance spine. `audit` verifies only (no progression).
   *  `supplementary` (A9): a turn-driven off-screen tick that rides ON TOP of a player turn the
   *  live loop already moved — it is pure society enrichment, so a tick that legitimately has
   *  nothing to add is a clean no-op, not a `no-daily-event` fault (the daily-event invariant is
   *  the live loop's own beats, not this background tick). Non-degradation and the Vault Wall are
   *  still enforced. A watcher/direct off-screen tick (no flag) keeps the daily-event check. */
  advance(user: string, trigger: Trigger, opts: { baseline?: SessionSnapshot; supplementary?: boolean } = {}): AdvanceResult {
    // The circuit breaker (B58/E6): after repeated identical faults, off-screen ticks SKIP this
    // sandbox instead of blindly retrying — the flag shows in health; a good player turn resets it.
    if (trigger === "offscreen-tick" && this.circuitOpen(user)) {
      return { events: 0, integrity: "fault", faults: this.health.get(user)?.faults.slice(-1) ?? [] };
    }
    // Deep endgame (0044 follow-through of the B52 rule): with fewer than two LIVING NPCs there is
    // no off-screen society left to run — e.g. the player standing in the Final 2, or no started
    // game at all (E2: the pool is zero pre-game). That tick is a clean no-op, NOT an integrity
    // fault: the daily-event invariant belongs to the live loop's own beats (the finale is full of
    // them), and flagging the empty house would log a false fault on every finale turn of a
    // healthy, player-won game.
    if (trigger === "offscreen-tick" && this.offscreenPoolSize(user) < 2) {
      return { events: 0, integrity: "ok", faults: [] };
    }
    const sandbox = this.registry.sandboxFor(user);
    // R3: a caller that JUST exported this exact state (the turn-driven tick runs right after its
    // commit stored the candidate) hands the snapshot over instead of paying a second O(events)
    // serialization — the per-mutation cost was ~4 full exports, quadratic over a season.
    const baseline = opts.baseline ?? this.registry.snapshot(user);

    let produced = 0;
    if (trigger !== "audit") {
      produced = this.applyFn(sandbox, trigger, this.rngFor(user), this.clock.now(), this.offscreenInteractions);
      // R3 — `applyFn` mutated the sandbox OUTSIDE the `commit` seam (it never fires `onPersist`), so the
      // registry's snapshot cache must be invalidated before we read the candidate, or it would hand back
      // the pre-tick capture. (An `audit` produces nothing, so its candidate IS the current cache.)
      this.registry.invalidateSnapshot(user);
    }

    const candidate = this.registry.snapshot(user);
    // R3: audits always full-verify (rare, and never count toward the fast-path window).
    const trustEventPrefix = trigger !== "audit" && this.trustEventPrefixFor(user);
    const faults = this.checkpoint(baseline, candidate, sandbox, trigger,
      { ...(opts.supplementary ? { requireDailyEvent: false } : {}), trustEventPrefix });
    const when = this.clock.now();

    if (faults.length === 0) {
      this.consecutiveFaults.set(user, 0); // any clean advance closes the circuit
      if (trigger !== "audit") { this.registry.saveUser(user, candidate); this.baselines.set(user, candidate); }
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
   *
   * A refused commit FAILS THE REQUEST (audit E3/D1): the rollback throws a typed error the HTTP
   * boundary maps to 4xx/5xx — never a 200 whose view narrates a beat that officially never
   * happened ("narrated but never recorded" at the engine seam).
   */
  commitPlayerTurn(user: string): void {
    const sandbox = this.registry.sandboxFor(user);
    const candidate = this.registry.snapshot(user);
    const when = this.clock.now();
    const baseline = this.baselines.get(user);

    // The first commit (e.g. createCharacter) has no prior good state — accept it and establish the
    // baseline; there is nothing to degrade away from. (A season RESTART through the one sanctioned
    // door lands here too: `forgetUser` cleared the dead season's baseline, so week 1 of season 2
    // is a first commit again, not a count regression against a finished season — E1/R1.)
    const faults = baseline
      ? this.checkpoint(baseline, candidate, sandbox, "player-turn",
          { requireDailyEvent: false, trustEventPrefix: this.trustEventPrefixFor(user) })
      : [];

    if (faults.length === 0) {
      try {
        this.registry.saveUser(user, candidate); // R3: reuse the exported snapshot — no re-serialize
      } catch {
        // E7: the SAVE itself failed (disk). Its own fault class — never fail-open (the turn must
        // not proceed unsaved), never misclassified as the caller's fault, no path in the message.
        this.recordFault(user, "player-turn", when, [{ when, kind: "persist-failure" }], baseline);
        throw new PersistFailureError();
      }
      this.consecutiveFaults.set(user, 0); // a good player turn closes the circuit (B58/E6)
      this.baselines.set(user, candidate);
      this.touch(user);
      this.maybeTurnDrivenTick(user, baseline, candidate); // may record an offscreen-tick health entry…
      this.recordHealth(user, this.registry.sandboxFor(user), "player-turn", when, "ok"); // …player-turn has the last word
      return;
    }
    // Fail-closed: roll the in-memory sandbox back to the last good state, DO NOT persist, and
    // surface the refusal as an ERROR to the caller (E3) — state unchanged, request failed.
    this.recordFault(user, "player-turn", when, faults, baseline);
    throw new TurnRefusedError(faults.map((f) => f.kind));
  }

  /** Roll back (when a good baseline exists), count the fault, log it, and record health. */
  private recordFault(
    user: string,
    trigger: Trigger,
    when: number,
    faults: Fault[],
    baseline: SessionSnapshot | undefined,
  ): void {
    if (baseline) this.registry.restore(user, baseline);
    this.consecutiveFaults.set(user, (this.consecutiveFaults.get(user) ?? 0) + 1);
    this.logFaults(user, trigger, faults);
    const prior = this.health.get(user);
    this.recordHealth(user, this.registry.sandboxFor(user), trigger, when, "fault",
      [...(prior?.faults ?? []), ...faults].slice(-Orchestrator.MAX_STORED_FAULTS));
  }

  /**
   * In pure turn-driven mode, advance one bounded off-screen tick so the house lives between turns
   * (B41) — debounced to the TURN boundary (audit E57/R5): a beat commit (the live loop genuinely
   * moved — an advance, a resolved decision) always earns its tick, but the auxiliary tool calls of
   * the same player turn (recordInteraction + diaryRoom + …) share one. Without the debounce a
   * 4-tool-call turn ran 4 ticks — force-marching the house and flooding the record. Never fires
   * pre-game (audit E2): the casting interview has no house to scheme in.
   */
  private maybeTurnDrivenTick(user: string, baseline: SessionSnapshot | undefined, candidate: SessionSnapshot): void {
    if (!this.turnDriven) return;
    if (!candidate.started) return; // E2: no off-screen life before move-in
    // Did the live loop move? Beat commits change the loop state; aux commits (an interaction, a
    // DR entry, a deal) never touch it. The loop state is small — this is NOT an events re-export.
    const progressed = !baseline || !baseline.started
      || baseline.week !== candidate.week
      || baseline.phase !== candidate.phase
      || JSON.stringify(baseline.live ?? null) !== JSON.stringify(candidate.live ?? null);
    const now = this.clock.now();
    const last = this.lastTurnTickAt.get(user);
    if (!progressed && last !== undefined && now - last < this.auxTickDebounceMs) return; // E57/R5
    this.lastTurnTickAt.set(user, now);
    // 0066 Phase-2 (Extension 1 — per-conversation clock advance): this is the once-per-player-TURN,
    // debounced seam (NOT the wall-clock watcher), so it is exactly "as the player lingers/plays". Press
    // the clock a small step here — the day's finite scheming time felt turn-by-turn. SELF-GATED in the
    // session (a no-op unless ORWELL_TIME_PER_CONVERSATION + the master clock are on): off ⇒ nothing
    // advances ⇒ byte-identical (the seeded spine never runs turn-driven anyway, but this keeps the
    // guarantee explicit). Pacing-only — it clamps at late-night and never wraps the night without the
    // player's own turnIn (ADR 0003 / the lull rule), so it cannot rush an engaged scene. No rng.
    this.registry.sandboxFor(user).session.advanceClockPerConversation();
    // R3: the commit just exported this. A9: a supplementary tick — an empty society this tick is
    // a clean no-op, not a daily-event fault (the live loop owns that invariant via its beats).
    this.advance(user, "offscreen-tick", { baseline: candidate, supplementary: true });
  }

  /**
   * R3 — whether THIS commit may trust the append-only event prefix (the O(Δ) fast path). The real
   * per-commit guarantees do NOT depend on this: a net drop of any persisted item is always caught by
   * countsNonDecreasing, the prefix boundary is always spot-checked, and every non-event dimension is
   * always fully verified. The fast path only relaxes the full EVENT-content re-scan, which the
   * append-only contract (events.record only ever APPENDS — never mutates/removes a past event) makes
   * redundant. We still force a FULL event re-scan on a user's FIRST commit and at least every
   * `R3_FULL_CHECK_EVERY` commits as cheap belt-and-suspenders. Advances the per-user counter.
   */
  private trustEventPrefixFor(user: string): boolean {
    const n = this.commitsSinceFullCheck.get(user) ?? 0;
    if (n === 0 || n >= Orchestrator.R3_FULL_CHECK_EVERY) {
      this.commitsSinceFullCheck.set(user, 1); // full check now; this commit opens the next window
      return false;
    }
    this.commitsSinceFullCheck.set(user, n + 1);
    return true;
  }

  /** Verify a candidate advance against the baseline — fail-closed (0031 §4.3). */
  checkpoint(
    baseline: SessionSnapshot,
    candidate: SessionSnapshot,
    sandbox: UserSandbox,
    trigger: Trigger = "player-turn",
    opts: { requireDailyEvent?: boolean; trustEventPrefix?: boolean } = {},
  ): Fault[] {
    const faults: Fault[] = [];
    const when = this.clock.now();
    const gsBase = toGameState(baseline);
    const gsCand = toGameState(candidate);

    // Non-degradation (0007): nothing previously persisted may be dropped. R3 — the append-only event
    // PREFIX may be trusted on the fast path (the orchestrator runs a FULL re-verification periodically);
    // every other dimension is fully verified, and a net DROP is always caught by countsNonDecreasing.
    // PERSIST-8: the 0007 GameState projection predates features 0058–0107, so it never covered the
    // newer SessionCore dimensions (deals, deepProfiles, confideState, secrets-as-power, nomination
    // history, texture overrides, …) — a regression there was invisible to this gate. `sessionCore*`
    // (src/engine/sessionSnapshot.ts) is the engine-layer companion check, same discipline, always
    // fully verified (these maps are small — no fast-path relaxation needed).
    if (!isSuperset(gsCand, gsBase, { trustEventPrefix: opts.trustEventPrefix === true })
        || !countsNonDecreasing(counts(gsCand), counts(gsBase))
        || !sessionCoreIsSuperset(candidate, baseline)
        || !sessionCoreCountsNonDecreasing(sessionCoreCounts(candidate), sessionCoreCounts(baseline))) {
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
    // Hidden contents are APPEND-ONLY (a hidden event is never mutated/removed — the same contract
    // `trustEventPrefix` rests on) and a vault-leak fault is TERMINAL (it rolls back, never commits) —
    // so a committed baseline holds ZERO unsanctioned hidden content in its view. On the fast path the
    // baseline's hidden PREFIX was therefore already verified leak-free; we re-scan only the hidden
    // contents NEW since the baseline against the full current view (O(Δ) rather than O(hidden×view),
    // the per-season quadratic this guard's `includes` scan was — CPU-profiled as ~88% of checkpoint
    // time). The full set is re-scanned on the first commit and at least every R3_FULL_CHECK_EVERY
    // commits (the SAME periodic belt-and-suspenders window `isSuperset`'s prefix trust uses), so the
    // rare case of an OLD hidden content newly surfacing verbatim in a re-rendered view is bounded
    // identically to the superset guard the owner sanctioned. The 0001 sentinel canary + the structural
    // Vault Wall remain the precise guards; this is the orchestrator's defense-in-depth.
    const allHidden = candidate.events.filter((e) => e.hidden).map((e) => e.content);
    const baselineHiddenCount = opts.trustEventPrefix === true
      ? baseline.events.reduce((n, e) => n + (e.hidden ? 1 : 0), 0)
      : 0;
    const hidden = baselineHiddenCount > 0 ? allHidden.slice(baselineHiddenCount) : allHidden;
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
      eventCount: sandbox.engine.events.count(),
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
      eventCount: this.registry.sandboxFor(user).engine.events.count(),
      lastIntegrity: "ok",
      faults: [],
      circuitOpen: false,
    };
  }
}

/** The default state-mutating step: a varied off-screen society + (player-turn) a witnessed day.
 *  Exported for the calibration-NEUTRALITY gates (the `richOffscreenStretch`/`scheduleStoryThreads`
 *  pattern): a test drives this directly with a RECORDING rng to prove the seeded draw stream the
 *  competition/vote/jury spine shares is byte-identical with a default-off feature flag on or off. */
export function defaultApply(sandbox: UserSandbox, trigger: Trigger, rng: SeededRandom, clockNow: number, interactions = 3): number {
  const core = sandbox.session.snapshot();
  // B52/audit D5: evicted houseguests stop living — they leave the off-screen society the moment
  // they go (no more scheming/confessing weeks after eviction). Only the LIVING NPCs of the REAL
  // house, ever: the old no-house synthetic pool (audit E2) fabricated hidden scenes + Vault
  // confessionals for houseguests that didn't exist yet — pre-game intake commits recorded
  // scheming dated before move-in, later humanized into the real cast's names. With no live house
  // there is NO ONE to scheme (the tick is gated upstream; this is the belt to that suspender).
  const evicted = new Set(core.live?.evictionOrder ?? []);
  const ids = (core.house?.npcs ?? []).filter((n) => !evicted.has(n.id)).map((n) => n.id);
  const before = sandbox.engine.events.count();

  // House presence (0049): the tick re-seats the house FIRST (seeded, affinity-clustered, adjacent
  // moves only), so this stretch's scenes happen somewhere and overhears have ground truth.
  sandbox.session.presenceTick(rng);
  // L21/L24: the off-screen society pairs CO-PRESENT NPCs, so its occupancy is calibration-load-bearing.
  // It reads the CALIBRATION-NEUTRAL base occupancy (invariant to the movement-personality constants) so
  // the seeded competition/vote outcomes stay byte-identical whether or not the weighting is enabled
  // (proven by tests/property/movementStreamIsolation). The player-facing WEIGHTED positions drive only
  // `whereabouts`/witnessing — which the player observes — never the hidden society's pairing.
  const occupancy = sandbox.session.societyOccupancy();

  // Off-screen society (0038): the house lives in MORE than one way — varied typed scenes the
  // player never witnesses (hidden; 0003), each folded with its REAL interaction nature (0023). A
  // houseguest's hidden element (B50) rarely slips into a scene's hidden content (rare-reveal loop).
  // 0091: a `trigger` element is EXCLUDED from this rare-reveal flavor pool — a trigger is pure sealed
  // state that manifests ONLY as its public ERUPTION (the `runTriggerEruptions` house event), never as
  // ordinary off-screen flavor that could later gossip-paraphrase toward the player ("X has a buried
  // temper"). The eruption is the one channel; the sealed wording itself stays fully inert. (This reads a
  // per-NPC SIDE rng only — the seeded calibration spine is untouched.)
  const hiddenOf = new Map((core.house?.npcs ?? [])
    .map((n) => [n.id, n.character.hiddenElements.filter((e) => e.kind !== "trigger")] as const));
  // ADR 0006: at night the house thins — houseguests past their character-driven bedtime have turned in
  // and leave the off-screen society (the night owls scheme on without them; a turned-in player misses
  // it). IDENTITY when the clock is off ⇒ the hidden society + the seeded calibration spine are byte-identical.
  const awakeIds = sandbox.session.awakeAmong(ids);
  // #840 — the live off-screen society must gate a SHOWMANCE the SAME way the seeded layer (0059/0063)
  // does: only between an orientation-plausible pair, and ≤1 active showmance partner per houseguest.
  // The session assembles both predicates from its Vault-sealed identities + seeded showmances (engine-
  // only — neither is projected); an ineligible draw is demoted to `bonding` inside the stretch.
  const showmanceGate = sandbox.session.offscreenShowmanceGate();
  const scenes = awakeIds.length >= 2
    ? richOffscreenStretch({
        events: sandbox.engine.events, rng, npcs: awakeIds, interactions,
        hiddenElementsOf: (id) => hiddenOf.get(id) ?? [],
        // E45 — motivated, co-present society: partners by tie strength, scenes need co-presence.
        edgeOf: (a, b) => sandbox.engine.relationships.edge(a, b),
        // #840 — orientation + one-partner showmance discipline (mirrors the seeded layer).
        showmancePlausible: showmanceGate.plausible,
        hasActiveShowmance: showmanceGate.hasActiveShowmance,
        // PV1 (#1029): the player may be NAMED as a SUBJECT of off-screen NPC cognition (never a
        // witness/partner — they are not in `npcs`). Reaches the player only via gossip/pathway.
        playerSubject: PLAYER,
        // 0087: when the trajectory layer is ON, the directed arc's hidden momentum TILTS this scene's
        // nature weights toward continuing the arc (a curdling pair clashes more). Passed ONLY when enabled
        // so the off-screen call is byte-identical to the pre-feature stretch when off; the tilt adds NO
        // rng (it re-weights the SAME single nature draw), so the seeded competition/vote spine stays in
        // phase even with it on.
        ...(sandbox.session.trajectoriesEnabledNow()
          ? { trajectoryOf: (a: EntityId, b: EntityId) => sandbox.session.trajectoryOf(a, b) }
          : {}),
        ...(occupancy ? { occupancy } : {}),
      })
    : []; // too few living NPCs to pair (deep endgame) — no off-screen society
  // 0087: the directed pairs that folded a scene THIS tick keep their freshly-built momentum; every other
  // tracked arc decays toward steady afterwards (the neglect cadence). Empty + unused when the layer is off.
  const touchedTrajectories = new Set<string>();
  for (const s of scenes) {
    // 0066 Phase-2: a tired INITIATOR sways the partner LESS (reduced effectiveness, never a personality
    // change). Scale is 1 when the clock is off ⇒ the fold is byte-identical to the calibration spine for
    // a GAME nature; the scaled path fires only on the live clock-ON game.
    //
    // 0078 Phase 2 — the scene's NATURE sets its fold (`natureFoldImpact`): a GAME scene folds its full
    // strategic IMPACT (trust/threat/alignment → the vote math), BYTE-IDENTICAL to before; a FRIENDLY
    // scene (bonding/showmance — ordinary downtime warmth) folds AFFINITY ONLY, no strategic weight, no
    // vote-affecting change. Always `applyImpactDirected` now, which takes the SAME four jitter draws as
    // the old `applyDirected`, so the stream stays in phase — only friendly magnitudes shift (re-calibrated).
    const swayScale = sandbox.session.socialFoldScale(s.initiator);
    const foldImpact = natureFoldImpact(s.type);
    sandbox.engine.relationships.applyImpactDirected(
      s.partner, s.initiator,
      swayScale === 1 ? foldImpact : scaleImpact(foldImpact, swayScale),
      rng,
    );
    // NOTE (audit 2026-06-18): whole-house transitivity for OFF-SCREEN NPC↔NPC scenes (co-present
    // bystanders reading a scene by structural balance) was prototyped here but destabilized the
    // tuned jury-reach calibration gate (a passive player's finale wins crept past the cap) — the
    // per-tick ripple compounds over a full season. The PLAYER-witnessed transitivity ships
    // (recordInteraction bystander fold); the off-screen whole-house ripple needs its own
    // calibration pass against tests/property/juryReach.property.test.ts before it returns.
    // 0041 (the linchpin pays off): the scene also deepens the initiator's soul — their arc accrues
    // and their mood drifts by the scene's nature, so the house's souls evolve BETWEEN turns (0038).
    sandbox.session.recordOffscreenScene(s.initiator, s.partner, s.type); // E50 — both roles evolve
    // 0087: fold the scene into the directed `initiator→partner` arc's hidden MOMENTUM (after the
    // relationship fold). Engine-side + pure (no rng): a no-op when the trajectory layer is off ⇒ the
    // calibration spine is untouched; when on, it updates the momentum that biases the NEXT tick's natures.
    sandbox.session.recordTrajectoryFold(s.initiator, s.partner, s.type);
    touchedTrajectories.add(`${s.initiator}->${s.partner}`);
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
  // 0070 — register this tick's scene ids with the session so `getOffscreenSceneSkeletons` returns
  // the CURRENT batch (transient; refreshed every tick; the event store is the durable source).
  sandbox.session.notifyOffscreenTick(scenes.map((s) => s.event.id));

  // 0087: decay every directed arc NOT fed this tick toward steady (the neglect cadence, mirroring 0026's
  // edge decay) — an unfed arc reverts to flat. Pure + no rng; a no-op when the trajectory layer is off.
  sandbox.session.decayUntouchedTrajectories(touchedTrajectories);

  // 0085 B2 — advance the live campaign layer one tick (form/advance/re-plan + diffuse knownTo). SELF-
  // GATED: a no-op (and zero draws) unless campaigns are enabled (ORWELL_CAMPAIGNS=1), so the calibration
  // harness — which never enables them — is byte-identical. Uses its own dedicated rng, never this tick's.
  sandbox.session.campaignTick();

  // 0100 — advance the sequestered JURY HOUSE one bounded stretch: the last-nine evictees keep living
  // (hidden juror↔juror scenes) and a grievance one juror carried out DIFFUSES to others, hardening the
  // room's read of the responsible houseguest before the finale. SELF-GATED: a no-op (ZERO draws, no
  // grudge) unless the layer is enabled (ORWELL_JURY_HOUSE=1) AND a jury already exists, so the
  // calibration harness — which never enables it — is byte-identical. Uses its OWN dedicated, isolated rng
  // (never this tick's shared stream), and records ONLY hidden events (witness set = jurors, EXCLUDES the
  // player). The main-house exclusion of evicted houseguests above is UNCHANGED — this is a strictly
  // ADDITIVE second society whose only downstream effect is the (hidden) jury lean, read at the finale.
  sandbox.session.juryHouseTick(sandbox.engine.events, sandbox.engine.knowledge);

  // B27b — live gossip: occasionally one of the night's scenes becomes a RUMOR that diffuses along
  // the affinity graph (who actually talks to whom), with low per-edge transmission, decaying
  // confidence, and per-telling drift. The PLAYER is a node like anyone: a chain that terminates at
  // them lands the belief — a vague paraphrase with source+confidence, never the verbatim hidden
  // scene and never a number. Every retelling is a recorded, traceable event (0002).
  if (core.house && scenes.length > 0 && rng.next() < GOSSIP.riseProb) {
    const scene = scenes[rng.int(scenes.length)]!;
    // The graph is the AWAKE house (ADR 0006), exactly like the off-screen society above: a
    // houseguest who has gone to bed neither retells nor receives a rumor at night (a pre-existing
    // gap — the graph used to be all living NPCs, so a telling could reach a sleeper). When the
    // clock is off (the default + the seeded calibration spine) `awakeAmong` is the whole roster, so
    // this is byte-identical there. The PLAYER is a node like anyone — but only while THEY are up.
    const everyone: EntityId[] = sandbox.session.awakeAmong([core.house.player.id, ...ids]);
    const edges: Array<readonly [EntityId, EntityId]> = [];
    for (let i = 0; i < everyone.length; i++) {
      for (let j = i + 1; j < everyone.length; j++) {
        // #565: symmetric edge selection (max of both directed reads) — a rumor travels along a bond
        // whenever EITHER party is warm enough to carry it. The directed-only test structurally
        // excluded the player (always `everyone[0]`, so only player→NPC was ever read) from the graph.
        if (gossipEdgeAffinity(sandbox.engine.relationships, everyone[i]!, everyone[j]!) > GOSSIP.affinityEdge) {
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
        // E44 — hearing a rumor moves the listener's read of its subjects (never the player's edges).
        rel: sandbox.engine.relationships,
        subjects: [scene.initiator, scene.partner],
        sceneType: scene.type,
      });
    }
  }

  // NPC interiority (0040): an involved houseguest privately confesses their REAL read — Vault-only
  // (witnessed by them alone), grounded in their actual relationship signals, never invented. It
  // reaches no one (player or admin); the player feels it only later through that NPC's behavior.
  if (scenes.length > 0) {
    const confessor = scenes[rng.int(scenes.length)]!.initiator;
    // 0089 — the off-screen confessional REACTS to the confessor's OWN witnessed events too (the scenes
    // they were just part of are already recorded this tick). `selectRecentForConfessional` bounds to
    // `witnessedBy: confessor` and returns only Vault-safe class-keyed gists — never another houseguest's
    // hidden read (mandate #2/#3). The tiebreak rng is DEDICATED (derived off confessor + clock + log
    // size), never the shared society/vote stream `rng`, so the seeded calibration spine is untouched
    // (the selection draws no rng at all unless two of the confessor's events fully tie).
    const recentRng = new SeededRandom(hashSeed(`${core.seed ?? ""}:confessional-recent:${confessor}:${clockNow}:${before}`));
    const recentEvents = selectRecentForConfessional(sandbox.engine.events.query(), confessor, clockNow, { rng: recentRng });
    // BB-2/SG-8 — without these three, EVERY confessional all season rendered the identical first
    // template (`pick()` falls back to `lines[0]` with no rng) and named the player with the bare
    // `player` id (no resolver), killing the 0048 retrospective payoff (41/41 identical lines). A
    // DEDICATED seeded rng (never the shared society/vote stream `rng` — the same isolation the
    // `recentRng` above already uses) drives 0090's phrasing variety; the confessor's own PUBLIC
    // 0084 voice colors which pool it draws from (never a fact, only texture); `nameOf` bakes the
    // confessor's actual read/display name for their target/ally — including the player's real name
    // in place of the literal "player" token.
    const phrasingRng = new SeededRandom(hashSeed(`${core.seed ?? ""}:confessional-phrasing:${confessor}:${clockNow}:${before}`));
    const houseguests = core.house?.npcs ?? [];
    const voice = houseguests.find((n) => n.id === confessor)?.character.voice;
    const nameOf = (id: EntityId): string =>
      core.house && id === core.house.player.id ? core.house.player.name : (houseguests.find((n) => n.id === id)?.name ?? id);
    recordConfessional(
      sandbox.engine.events,
      confessionalFor(confessor, ids, sandbox.engine.relationships, {
        player: PLAYER,
        recentEvents,
        rng: phrasingRng,
        voice,
        nameOf,
      }),
      rng,
      clockNow,
    );
  }

  // 0091 — TRIGGER ERUPTIONS: AFTER the society/confessional folds, a plausibly-strained, co-present
  // houseguest whose volatile sealed trigger meets a fresh SPARK this tick (a conflict/betrayal scene that
  // just named them) can DETONATE into a Vault-safe PUBLIC house event the player witnesses. STRICTLY
  // OPT-IN (default-OFF `ORWELL_TRIGGERS`): when off — the default, and the state the seeded juryReach/
  // gradient/UAT sims run in — the call is skipped entirely (no precipitant map built, no draw, no event,
  // no fold), so this tick is byte-identical to the pre-feature build and the seeded competition/vote spine
  // is untouched. When on, the fire check runs on a DEDICATED rng INSIDE the session (never this shared
  // stream above) — the load-bearing calibration-neutrality guarantee. The precipitant is THIS tick's fresh
  // sparks: a conflict/betrayal scene anchors the eruption to a live moment (the no-cold-open guarantee).
  if (sandbox.session.triggersEnabledNow()) {
    const precipitants = new Map<EntityId, number>();
    for (const s of scenes) {
      const spark = s.type === "betrayal" ? 1 : s.type === "conflict" ? 0.8 : 0;
      if (spark === 0) continue;
      precipitants.set(s.initiator, Math.max(precipitants.get(s.initiator) ?? 0, spark));
      precipitants.set(s.partner, Math.max(precipitants.get(s.partner) ?? 0, spark));
    }
    sandbox.session.runTriggerEruptions(sandbox.engine.events, precipitants);
  }

  // A meaningful, player-witnessed day event (daily-event invariant, 0008; E58 ambient variety).
  // BUGFIX: this used to gate on `trigger === "player-turn"`, a value `advance()` never actually
  // passes to `applyFn`/`defaultApply` in real play — `commitPlayerTurn` never calls `advance()`
  // directly, and the turn-driven tick it DOES fire always carries `"offscreen-tick"` (the R5/E57
  // debounce refactor renamed the calling convention without updating this gate). The result: the
  // entire ambient house-event pool was dead code for every real game, satisfying the daily-event
  // invariant with ceremony beats alone and none of this module's "the house lives between
  // ceremonies" texture. Gate on "any real tick, not an audit dry run" instead — `defaultApply` is
  // only ever invoked with `trigger !== "audit"` in the first place (see `advance()` above), so this
  // now fires for both the real production trigger and the legacy test-driven "player-turn" calls.
  //
  // CALIBRATION-NEUTRALITY: the ambient pick draws on a DEDICATED, isolated rng keyed off the game
  // seed + moment (the same pattern as the confessional phrasing/recent rngs above), NEVER the shared
  // `rng` stream this function threads through the seeded society / gossip / story-thread spine. Pure
  // texture — it records one player-witnessed house-event but consumes ZERO draws from the shared
  // stream, so the downstream `scheduleStoryThreads(rng)` (and every seeded competition/vote/jury roll)
  // stays byte-identical whether or not this block fires. Firing it on the real tick is what finally
  // lets the pool reach a live player; the dedicated rng is what keeps that texture-only.
  //
  // ONCE-PER-DAY cadence (audit COMP-7): the turn-driven tick fires on every progressed beat AND, once
  // per turn, on the debounced aux commits (a recorded scene, a deal). Recording a fresh ambient day
  // headline on each would FLOOD the record ("several a week" was already too many) and mislabel a
  // mid-day side-conversation as a new day event. So we dedupe on the in-game DAY: the ambient headline
  // is stamped `Week W[, day D]:` by `nextHouseEvent`, and we record at most one per distinct stamp —
  // it fires when the player first arrives at a new (week, day) and then stays quiet until the day turns
  // over, no matter how many aux ticks the turn produces. (Ceremony house-events carry no such stamp, so
  // this never suppresses a real HOH/nomination/eviction beat.)
  if (trigger !== "audit" && ids.length > 0) {
    const day = dayOfWeek(core.phase);
    const stamp = day === null ? `Week ${core.week}` : `Week ${core.week}, day ${day}`;
    const alreadyToday = sandbox.engine.events
      .query({ type: "house-event" })
      .some((e) => e.content.startsWith(`${stamp}:`));
    if (!alreadyToday) {
      const ambientRng = new SeededRandom(
        hashSeed(`${core.seed ?? ""}:house-event:${core.week}:${core.phase}:${before}`),
      );
      sandbox.engine.events.record({
        id: `orch:day:${clockNow}:${before}`,
        ts: clockNow,
        type: "house-event",
        initiator: ids[0]!,
        witnessSet: [PLAYER, ids[0]!],
        hidden: false,
        content: nextHouseEvent(sandbox.engine.events, ambientRng, { week: core.week, phase: core.phase }), // E58: varied + day-indexed, never a verbatim repeat
      });
    }
  }
  // 0059/L40 — advance the seeded showmances on the affinity the scenes just moved. A showmance that
  // crosses into `visible` becomes a PUBLIC house fact; the adapter's onShowmanceSurfaced hook (wired
  // in the registry) records the player-witnessed beat. Pre-visible showmances stay Vault-sealed.
  sandbox.session.advanceShowmances();
  // 0092 — the SECRET-PACING DRIP runs BEFORE 0060's surface-to-player decision: it PACES which sealed
  // secret edges toward THIS player and how fast (a per-week budget, relationship-weighted), routing a
  // ripe top candidate into 0060's EXISTING anchored surface path (the confidant slip / gossip chain) —
  // it adds no new pathway. STRICTLY OPT-IN (default-OFF `ORWELL_SECRET_PACING`): when off — the default,
  // and the state the seeded juryReach/gradient/UAT sims run in — it returns immediately and draws
  // nothing, so 0060's own flat path is the only one that runs and this tick is byte-identical to the
  // pre-feature build. When on, every roll is on a DEDICATED rng INSIDE the session (never this shared
  // stream), and the only thing it changes is which already-Wall-safe surface 0060 picks + whether the
  // weekly budget allows it ⇒ the seeded comp/vote/jury spine is untouched (the load-bearing guarantee).
  sandbox.session.pacingDrip();
  // 0060 — the story-thread scheduler rides THIS bounded tick (after society/gossip/confessional, so it
  // reads the freshly-moved house). It walks each seeded thread's lifecycle — dormant→active (reusing
  // the 0023 fold), active→surfaced (reusing 0038 gossip / 0002 pathways, capped per §5), and →resolved
  // / →expired (recorded, never deleted). It AUTHORS nothing; it only decides WHEN each transition
  // fires, on a seeded SIDE rng so the main beat stream stays byte-stable (0007). Engine-only: nothing
  // crosses but a class-keyed paraphrase belief (never the premise, never a number — §7).
  sandbox.session.scheduleStoryThreads(rng);
  // 0077 NPC-side increment — the house WHISPERS about closed-door pairings: a conspicuous NPC pair
  // holed up in a private room is noticed by a plausibly-positioned third houseguest, and a Vault-free
  // POSITION suspicion (who/where, never the sealed content) diffuses NPC-to-NPC and can reach the
  // player. Runs LAST and on a DEDICATED rng inside the session (never the shared stream above) with NO
  // relationship fold ⇒ calibration byte-identical (the seeded society/vote spine is untouched; the
  // gossip/surfacing events it records are a type `nextHouseEvent`/confessionals never scan).
  sandbox.session.whisperPairings(sandbox.engine.knowledge);
  // 0059 §5 — the organic pre-game-TIE surfacing scheduler (the DEFERRED follow-on). Runs LAST, like the
  // whisper above, and is STRICTLY OPT-IN (default-OFF `ORWELL_SEEDED_TIE_SURFACING`): when off — the
  // default, and the state the seeded juryReach/gradient/UAT sims run in — it returns immediately and
  // touches nothing (no draw, no event, no fold), so this tick is byte-identical to the pre-feature build.
  // When on, it surfaces a warmed seeded tie through a DEDICATED rng (never this shared stream) + 0002
  // pathways and folds the discovery via 0023 — texture, never the calibration spine.
  sandbox.session.advanceSeededTies(sandbox.engine.knowledge);
  // Feature 0095 — the pre-show-TIE REVEAL pathway (the OVERHEAR route; a SEPARATE, distinct pathway from
  // 0059 §5 above, with its own flag/gate/rng — turning one on does not turn on the other). Runs LAST,
  // like the whisper/§5 above, and is STRICTLY OPT-IN (default-OFF `ORWELL_TIE_REVEAL`): when off — the
  // default, and the state the seeded juryReach/gradient/UAT sims run in — it returns immediately and
  // touches nothing, so this tick is byte-identical to the pre-feature build. When on, a conspicuous
  // sealed tie can come OUT for real (the actual pre-show connection, not §5's vague "seem close"),
  // diffusing as a genuine confidence-scaled betrayal-grade belief on its OWN dedicated rng stream.
  sandbox.session.advanceTieReveal(sandbox.engine.knowledge);
  // Every recorded scene (+ the player-turn day) counts toward the advance.
  return sandbox.engine.events.count() - before;
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
