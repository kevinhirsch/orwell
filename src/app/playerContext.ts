import type { EventStore } from '../ports/EventStore';
import { PlayerSurface } from '../surfaces/PlayerSurface';

/**
 * Player composition root — wires NON-Vault ports only.
 * MUST NOT import VaultStore or VectorIndex (the Vault Wall; enforced by dependency-cruiser).
 */
export function makePlayerSurface(events: EventStore): PlayerSurface {
  return new PlayerSurface(events);
}
