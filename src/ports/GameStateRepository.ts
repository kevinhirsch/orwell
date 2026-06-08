/** Admin/God-Mode-visible state. NON-VAULT by construction. */
export interface PublicHouseguest {
  role: string;
  status: string;
}

export interface AdminVisibleState {
  week: number;
  phase: string;
  houseguests: PublicHouseguest[];
  [k: string]: unknown;
}

/** A non-Vault mechanic override (advance a phase, toggle the scheduler, set a tunable). */
export interface OverrideChange {
  mechanic: string;
  value: unknown;
}

export type SandboxOp = "create" | "reset" | "save" | "load";

export interface GameStateRepository {
  getAdminVisibleState(): AdminVisibleState;
  /** Apply a NON-VAULT mechanic override; returns the updated non-Vault state. */
  applyOverride(change: OverrideChange): AdminVisibleState;
  /** Merge NON-VAULT tunable knobs (temperature/relationship config, reserve-twist COUNT — never content). */
  configure(knobs: Record<string, unknown>): AdminVisibleState;
  /** Sandbox lifecycle for THIS sandbox only (create | reset | save | load). */
  manageSandbox(op?: SandboxOp): AdminVisibleState;
}
