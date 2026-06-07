import type { GameStateRepository, AdminVisibleState } from "../../ports/GameStateRepository";

export class InMemoryGameStateRepository implements GameStateRepository {
  constructor(private state: AdminVisibleState) {}

  getAdminVisibleState(): AdminVisibleState {
    return structuredClone(this.state);
  }

  setAdminVisibleState(state: AdminVisibleState): void {
    this.state = state;
  }
}
