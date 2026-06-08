import type { GameStateRepository, AdminVisibleState } from "../../ports/GameStateRepository";

/**
 * Administrator / God Mode. Configures, overrides mechanics, and inspects
 * NON-VAULT state. It is walled from the Vault even for the admin — there is no
 * method that returns Vault data and no dependency on `VaultStore`.
 */
export class AdminPort {
  constructor(private readonly state: GameStateRepository) {}

  inspect(): AdminVisibleState {
    return this.state.getAdminVisibleState();
  }
}
