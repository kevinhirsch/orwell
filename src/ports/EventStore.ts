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
   * The number of recorded events — O(1). Many hot-path call sites only need the count (to mint a
   * monotonic id/ts, or to report `eventCount`); `query().length` allocated a full filtered array
   * copy of the whole log every time, which is O(events) and quadratic over a season. `count()` is
   * the byte-identical, allocation-free count of the unfiltered log.
   */
  count(): number;
  /**
   * Restore a persisted event EXACTLY (id/ts/hidden byte-identical) — the 0030 resume path. Unlike
   * `record`, it bypasses the monotonic-tick normalization so a restored history round-trips with no
   * drift. Part of the port (E63) so the durable-snapshot resume goes THROUGH the seam — the
   * composition root never hard-casts a concrete adapter to reach it.
   */
  restoreRecord(event: GameEvent): void;
}
