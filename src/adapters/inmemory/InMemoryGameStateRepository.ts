import type {
  GameStateRepository, AdminVisibleState, OverrideChange, SandboxOp,
} from "../../ports/GameStateRepository";

/**
 * In-memory non-Vault game state for the admin / God-Mode surface. It holds ONLY
 * non-Vault state (week, phase, public roster, config knobs) — there is no Vault
 * handle here, so nothing it returns can carry secret content (the admin wall,
 * 0001/0016). Mutations affect THIS sandbox instance only (sandbox isolation).
 */
export class InMemoryGameStateRepository implements GameStateRepository {
  private readonly initial: AdminVisibleState;

  constructor(private state: AdminVisibleState) {
    if (!this.state.config) this.state.config = {};
    this.initial = structuredClone(this.state);
  }

  getAdminVisibleState(): AdminVisibleState {
    return structuredClone(this.state);
  }

  setAdminVisibleState(state: AdminVisibleState): void {
    this.state = state;
  }

  private config(): Record<string, unknown> {
    if (!this.state.config) this.state.config = {};
    return this.state.config as Record<string, unknown>;
  }

  applyOverride(change: OverrideChange): AdminVisibleState {
    const { mechanic, value } = change ?? ({} as OverrideChange);
    if (mechanic === "phase") this.state.phase = String(value);
    else if (mechanic === "week") this.state.week = Number(value);
    else if (mechanic) this.config()[mechanic] = value; // any other non-Vault knob
    return this.getAdminVisibleState();
  }

  configure(knobs: Record<string, unknown>): AdminVisibleState {
    // Reserve-twist COUNT is a knob here; the twist CONTENT is engine/Vault-generated, never stored
    // on this non-Vault surface — so enabling twists never reveals what/when (0005/0016).
    this.state.config = { ...this.config(), ...(knobs ?? {}) };
    return this.getAdminVisibleState();
  }

  manageSandbox(op?: SandboxOp): AdminVisibleState {
    if (op === "reset") this.state = structuredClone(this.initial);
    else if (op) this.state.lifecycle = op;
    return this.getAdminVisibleState();
  }
}
