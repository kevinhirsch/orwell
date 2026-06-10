import type {
  GameStateRepository, AdminVisibleState, OverrideChange, SandboxOp,
} from "../../ports/GameStateRepository";

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

  /** Manage this sandbox only (create | reset | save | load). A reset re-onboards the REAL game. */
  manageSandbox(op?: SandboxOp): AdminVisibleState {
    const out = this.state.manageSandbox(op);
    if (op === "reset") this.onReset?.(); // B58/E5: the reset reaches the registry, not just the stub
    return out;
  }
}
