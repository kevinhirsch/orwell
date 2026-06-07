import { setWorldConstructor, World, type IWorldOptions } from '@cucumber/cucumber';
import { InMemoryEventStore } from '../../src/adapters/memory/InMemoryEventStore';
import { InMemoryVaultStore } from '../../src/adapters/memory/InMemoryVaultStore';
import { makePlayerSurface } from '../../src/app/playerContext';
import { makeAdminPort } from '../../src/app/adminContext';
import type { PlayerSurface } from '../../src/surfaces/PlayerSurface';
import type { AdminPort } from '../../src/surfaces/AdminPort';

/**
 * Cucumber World for the Vault Wall feature. The engine wires the Vault; the player and
 * admin surfaces are built from their own composition roots, which have no Vault handle.
 */
export class BbWorld extends World {
  readonly vault = new InMemoryVaultStore();
  readonly events = new InMemoryEventStore();
  readonly sentinels: string[] = [];
  readonly player: PlayerSurface = makePlayerSurface(this.events);
  readonly admin: AdminPort = makeAdminPort(this.events);
  output = '';

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(BbWorld);
