import type { GameSessionRegistry } from "./registry";
import type { Orchestrator } from "./orchestrator";
import type { Clock, Scheduler, SchedulerHandle } from "../ports/Clock";

/**
 * The background supervisor (feature 0031) behind the Clock/Scheduler port. It
 * holds NO game logic — on each clock tick it only (a) triggers a bounded
 * off-screen `advance` on idle sandboxes so the house keeps scheming between
 * sessions, and (b) runs the integrity audit across all sandboxes. Every advance
 * stays inside one sandbox (isolation, 0021). A fake clock makes it fully
 * deterministic; `tickEveryMs: 0` disables it entirely (pure turn-driven).
 */
export interface WatcherConfig {
  /** Wake cadence. 0 disables the watcher (games never self-advance). */
  tickEveryMs: number;
  /** A sandbox idle at least this long gets off-screen ticks. */
  idleTickAfterMs: number;
  /** Cap on off-screen advances per wake, so a long absence doesn't fast-forward a season. */
  maxOffscreenTicksPerWake: number;
  /** Integrity-audit cadence. 0 disables auditing. */
  auditEveryMs: number;
}

export class GameWatcher {
  private handle: SchedulerHandle | null = null;
  private lastAuditAt = 0;

  constructor(
    private readonly registry: GameSessionRegistry,
    private readonly orchestrator: Orchestrator,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly cfg: WatcherConfig,
  ) {}

  start(): void {
    if (this.cfg.tickEveryMs <= 0) return; // disabled ⇒ pure turn-driven fallback
    this.lastAuditAt = this.clock.now();
    this.handle = this.scheduler.every(this.cfg.tickEveryMs, () => this.onTick());
  }

  stop(): void {
    if (this.handle) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
    }
  }

  private onTick(): void {
    const now = this.clock.now();

    for (const user of this.registry.usernames()) {
      if (!this.registry.sandboxFor(user).session.snapshot().started) continue;
      // The house lives between sessions: bounded off-screen ticks on idle games.
      if (now - this.orchestrator.idleSince(user) >= this.cfg.idleTickAfterMs) {
        for (let i = 0; i < this.cfg.maxOffscreenTicksPerWake; i++) {
          this.orchestrator.advance(user, "offscreen-tick");
        }
      }
    }

    // Integrity audit on its own cadence — verify only, no progression.
    if (this.cfg.auditEveryMs > 0 && now - this.lastAuditAt >= this.cfg.auditEveryMs) {
      this.lastAuditAt = now;
      for (const user of this.registry.usernames()) this.orchestrator.advance(user, "audit");
    }
  }
}
