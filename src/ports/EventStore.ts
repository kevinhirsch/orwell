import type { GameEvent, EntityId } from "../domain/event";

export interface EventQuery {
  /** Only events whose witness set includes this entity (i.e. VISIBLE to them). */
  witnessedBy?: EntityId;
  hidden?: boolean;
  type?: string;
}

/** The single interaction record. Not the Vault — outward code may read this. */
export interface EventStore {
  record(event: GameEvent): void;
  query(filter?: EventQuery): GameEvent[];
}
