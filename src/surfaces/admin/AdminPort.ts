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

  /** Manage this sandbox only (create | reset | save | load). */
  manageSandbox(op?: SandboxOp): AdminVisibleState {
    return this.state.manageSandbox(op);
  }
}
