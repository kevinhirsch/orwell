import type { EventStore, EventQuery } from "../../ports/EventStore";
import type { GameEvent } from "../../domain/event";
import { classify, validateEvent } from "../../domain/event";

export class InMemoryEventStore implements EventStore {
  private readonly events: GameEvent[] = [];
  private readonly ids = new Set<string>();
  /** The sandbox's ONE monotonic tick (B60/audit E12): event `ts` always sorts coherently. */
  private lastTs = 0;

  record(event: GameEvent): void {
    validateEvent(event); // reject any mislabeled (e.g. player-witnessed-but-hidden) event
    // Reject a DUPLICATE id (B40/audit C2): a restarted counter that re-mints an existing id would
    // silently corrupt the id-keyed superset checkpoint (0031) — fail loud instead of accepting it.
    if (this.ids.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    this.ids.add(event.id);
    // One monotonic per-sandbox tick (B60/E12): producers used to stamp ts with their OWN semantics
    // (loop indices, wall clocks, store sizes), so ordering by ts was meaningless. The store is now
    // the tick authority: a ts that would go backwards is normalized to last+1; a larger ts advances
    // the tick. (`restoreRecord` bypasses this so a restored history round-trips exactly.)
    const ts = event.ts > this.lastTs ? event.ts : this.lastTs + 1;
    this.lastTs = ts;
    this.events.push({ ...event, ts });
  }

  /** Restore a persisted event EXACTLY (id/ts/hidden byte-identical) — the 0030 resume path. */
  restoreRecord(event: GameEvent): void {
    validateEvent(event);
    if (this.ids.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    this.ids.add(event.id);
    this.lastTs = Math.max(this.lastTs, event.ts);
    this.events.push(event);
  }

  query(filter: EventQuery = {}): GameEvent[] {
    // Fast path for the dominant call: no filter ⇒ a single fresh shallow copy (callers may sort/
    // splice the result, so we never hand back the live backing array). Byte-identical to the
    // `.filter(() => true)` it replaces, but without the per-element predicate dispatch.
    if (filter.witnessedBy === undefined && filter.hidden === undefined && filter.type === undefined) {
      return this.events.slice();
    }
    return this.events.filter((e) => {
      if (filter.witnessedBy !== undefined && classify(e, filter.witnessedBy) !== "VISIBLE") return false;
      if (filter.hidden !== undefined && e.hidden !== filter.hidden) return false;
      if (filter.type !== undefined && e.type !== filter.type) return false;
      return true;
    });
  }

  /** O(1) count of the unfiltered log — no array allocation (the hot-path id/ts/count seam). */
  count(): number {
    return this.events.length;
  }
}
