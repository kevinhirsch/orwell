import type { EventStore } from '../ports/EventStore';
import { AdminPort } from '../surfaces/AdminPort';

/**
 * Admin / God-Mode composition root — wires NON-Vault ports only.
 * MUST NOT import VaultStore or VectorIndex (the Vault Wall; enforced by dependency-cruiser).
 */
export function makeAdminPort(events: EventStore): AdminPort {
  return new AdminPort(events);
}
