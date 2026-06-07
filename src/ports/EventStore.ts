import type { GameEvent } from '../domain/types';

/**
 * The single interaction record. Outward-facing code reads only through visibility-filtered
 * views (e.g. `visibleTo`) — never the raw Vault.
 */
export interface EventStore {
  record(event: GameEvent): void;
  all(): readonly GameEvent[];
  /** Events whose witness set includes the entity — the only events visible to them. */
  visibleTo(entity: string): readonly GameEvent[];
}
