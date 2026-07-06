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
  /**
   * BE-6: a FILTERED read — at least one of `witnessedBy`/`hidden`/`type` MUST be set, or the
   * implementation throws. Bare, unfiltered `query()` used to fast-path to the FULL log (Vault-hidden
   * content included) whenever no filter was supplied, making the safe call (an explicit filter) opt-in
   * effort and the unsafe call (bare `.query()`) the path of least resistance for a future outward-
   * reachable caller. Genuinely-unfiltered engine-internal reads (gossip pathway search, snapshot
   * export, confessional/richness scans) must call `queryAll()` explicitly instead.
   */
  query(filter: EventQuery): GameEvent[];
  /** The FULL unfiltered log (Vault-hidden content included) — the explicit, clearly-named escape hatch
   *  for the small set of genuinely engine-internal callers that need everything (BE-6). Never call this
   *  from a player- or admin-facing surface. */
  queryAll(): GameEvent[];
  /**
   * The events appended AT OR AFTER index `fromIndex` in the append-only log, in order — the O(Δ) tail
   * (0065 Part E). It copies ONLY `count() - fromIndex` elements (an array slice from an offset), never
   * the whole log, so the delta state feed's per-turn work tracks the number of new events, not the
   * total accumulated history (the R3 latency cure). `fromIndex` is clamped to `[0, count()]`; a value at
   * or beyond `count()` returns an empty array. The log is insertion-ordered, so the tail is exactly the
   * events recorded since the caller last observed `fromIndex` events.
   */
  eventsSince(fromIndex: number): GameEvent[];
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
