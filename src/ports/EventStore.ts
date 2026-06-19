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
  /**
   * Restore a persisted event EXACTLY (id/ts/hidden byte-identical) — the 0030 resume path. Unlike
   * `record`, it bypasses the monotonic-tick normalization so a restored history round-trips with no
   * drift. Part of the port (E63) so the durable-snapshot resume goes THROUGH the seam — the
   * composition root never hard-casts a concrete adapter to reach it.
   */
  restoreRecord(event: GameEvent): void;
}
