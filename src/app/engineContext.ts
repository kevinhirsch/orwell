import type { VaultStore } from '../ports/VaultStore';
import type { EventStore } from '../ports/EventStore';

/**
 * Engine composition root — the ONLY place the Vault (and, later, the vector index) is wired.
 * The simulation reads the Vault to drive off-screen life; it never hands Vault data to an
 * outward-facing surface.
 */
export interface EngineContext {
  readonly vault: VaultStore;
  readonly events: EventStore;
}

export function makeEngineContext(vault: VaultStore, events: EventStore): EngineContext {
  return { vault, events };
}
