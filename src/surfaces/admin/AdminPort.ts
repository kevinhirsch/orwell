import type {
  GameStateRepository, AdminVisibleState, OverrideChange, SandboxOp,
} from "../../ports/GameStateRepository";
import type { FinaleFastForwardView } from "../../ports/GameSession";

/**
 * Administrator / God Mode (0016). Inspects, overrides non-Vault mechanics,
 * configures tunables, and manages the sandbox lifecycle. It is walled from the
 * Vault even for the admin — every method returns NON-VAULT state, there is no
 * "reveal the Vault" capability, and there is no dependency on `VaultStore`
 * (proven structurally by dependency-cruiser and by the sentinel canary, 0001).
 */
export class AdminPort {
  constructor(private readonly state: GameStateRepository) {}

  /**
   * The REAL sandbox-reset delegate (B58/audit E5): the composition layer wires this to
   * `registry.resetUser`, so the admin's `manageSandbox("reset")` actually re-onboards the game
   * instead of mutating a stub nothing reads. Vault-free: the delegate is a void closure.
   */
  private onReset?: () => void;

  setResetDelegate(fn: () => void): void {
    this.onReset = fn;
  }

  /**
   * Vault-free sandbox health (B58/audit E5+E6): the composition layer wires this to the
   * orchestrator's `sandboxHealth` so God Mode can SEE integrity faults and the circuit state.
   * Returns null when no orchestrator is composed (standalone sandboxes).
   */
  private healthProvider?: () => unknown;

  setHealthProvider(fn: () => unknown): void {
    this.healthProvider = fn;
  }

  /** Vault-free health metadata (week/phase/integrity/faults) — never game content. */
  health(): unknown {
    return this.healthProvider?.() ?? null;
  }

  /**
   * The fast-forward-to-finale lever (L38): the composition layer wires this to the live session's
   * `advanceToFinale`, which DRIVES the deterministic engine to a crowned winner (auto-resolving the
   * player's pendings with legal defaults). It is VAULT-FREE BY CONSTRUCTION — the delegate returns
   * only PUBLIC ceremony facts (winner NAME, weeks, the player's placement), reads no Vault, and does
   * NOT touch the `seasonRetrospective` gate (that still opens ONLY post-finale, through its own code
   * path). Returns a not-started summary when no orchestrator/session is composed.
   */
  private fastForwardProvider?: () => FinaleFastForwardView;

  setFastForwardProvider(fn: () => FinaleFastForwardView): void {
    this.fastForwardProvider = fn;
  }

  /**
   * God-Mode "fast-forward to finale (debug)" (L38): finish the season legitimately so the
   * post-season Vault retrospective (0048) unseals. It REVEALS nothing — only the Vault-free
   * public summary crosses (winner NAME, weeks played, the player's final placement).
   */
  advanceToFinale(): FinaleFastForwardView {
    return this.fastForwardProvider?.() ?? {
      finished: false, winnerName: null, weeks: 0, playerPlacement: "unknown", started: false,
    };
  }

  /** Inspect non-Vault state (week, phase, public roster, config). */
  inspect(): AdminVisibleState {
    return this.state.getAdminVisibleState();
  }

  /** Override a non-Vault mechanic; returns the updated non-Vault state. */
  overrideMechanic(change: OverrideChange): AdminVisibleState {
    return this.state.applyOverride(change);
  }

  /** Set non-Vault tunables (temperature/relationship config, reserve-twist COUNT — not content). */
  configure(knobs: Record<string, unknown>): AdminVisibleState {
    return this.state.configure(knobs);
  }

  /**
   * ADR 0006 — flip the in-game clock + sleep economy at runtime (the FE settings switch). The composition
   * layer wires the delegate to the engine's process-global override (a Vault-free void closure — exactly
   * like the reset/health/fast-forward delegates above), so this OUTWARD surface never imports the engine
   * adapter (the dependency-cruiser boundary holds).
   */
  private timeOfDayDelegate?: (enabled: boolean) => void;

  setTimeOfDayDelegate(fn: (enabled: boolean) => void): void {
    this.timeOfDayDelegate = fn;
  }

  setTimeOfDay(enabled: boolean): AdminVisibleState {
    this.timeOfDayDelegate?.(enabled);
    return this.state.getAdminVisibleState();
  }

  /** Manage this sandbox only (create | reset | save | load). A reset re-onboards the REAL game. */
  manageSandbox(op?: SandboxOp): AdminVisibleState {
    const out = this.state.manageSandbox(op);
    if (op === "reset") this.onReset?.(); // B58/E5: the reset reaches the registry, not just the stub
    return out;
  }
}
