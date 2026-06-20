import type { EventStore, EventQuery } from "../../ports/EventStore";
import type { GameEvent } from "../../domain/event";
import { classify, validateEvent } from "../../domain/event";

export class InMemoryEventStore implements EventStore {
  private readonly events: GameEvent[] = [];
  private readonly ids = new Set<string>();
  /** The sandbox's ONE monotonic tick (B60/audit E12): event `ts` always sorts coherently. */
  private lastTs = 0;
  /**
   * R3 (incremental snapshot) — a cached IMMUTABLE copy of the unfiltered log. The log is append-only
   * (record/restoreRecord only ever `push`; nothing mutates or removes a past event), so a snapshot's
   * full copy stays a faithful clone until the NEXT append. The dominant per-commit cost was the O(events)
   * `.slice()` that `exportSnapshot` paid on every mutation — many of which append NO event (a knowledge
   * surfacing, a deal, a DR entry), yet each still re-sliced the whole, ever-growing log. Here that re-slice
   * happens at most ONCE per appended event; an export with no new event reuses the frozen copy by reference,
   * so the events portion of the snapshot is O(1) between appends instead of O(total history) every commit.
   * `Object.freeze` makes the contract enforced, not just documented: a caller that tried to sort/splice the
   * result would throw — and no caller does (the projection treats `events` as read-only; the few callers
   * that need to mutate go through the filtered branch below, which always returns a fresh array).
   */
  private fullQueryCache: readonly GameEvent[] | null = null;

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
    this.fullQueryCache = null; // a new append invalidates the cached immutable copy
  }

  /** Restore a persisted event EXACTLY (id/ts/hidden byte-identical) — the 0030 resume path. */
  restoreRecord(event: GameEvent): void {
    validateEvent(event);
    if (this.ids.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    this.ids.add(event.id);
    this.lastTs = Math.max(this.lastTs, event.ts);
    this.events.push(event);
    this.fullQueryCache = null; // a restored append invalidates the cached immutable copy
  }

  query(filter: EventQuery = {}): GameEvent[] {
    // Fast path for the dominant call: no filter ⇒ an IMMUTABLE shared copy, rebuilt only when the log
    // grew (R3). Append-only means the frozen copy is byte-identical to the live log between appends, so
    // the snapshot export reuses it by reference instead of re-`.slice()`ing the whole history every commit.
    if (filter.witnessedBy === undefined && filter.hidden === undefined && filter.type === undefined) {
      if (this.fullQueryCache === null || this.fullQueryCache.length !== this.events.length) {
        this.fullQueryCache = Object.freeze(this.events.slice());
      }
      return this.fullQueryCache as GameEvent[];
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

  /**
   * 0065 Part E — the O(Δ) tail: the events appended at or after `fromIndex`, in order. `Array.slice(from)`
   * copies ONLY `length - from` elements, so the delta state feed's per-turn work tracks the number of NEW
   * events, never the whole, ever-growing log (the R3 latency cure). The log is insertion-ordered and
   * append-only (record/restoreRecord only push), so the tail is exactly what was recorded since the
   * caller last observed `fromIndex` events. `fromIndex` is clamped into `[0, length]`.
   */
  eventsSince(fromIndex: number): GameEvent[] {
    const from = Math.max(0, Math.min(fromIndex, this.events.length));
    return this.events.slice(from);
  }
}
