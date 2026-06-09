import type { EventStore, EventQuery } from "../../ports/EventStore";
import type { GameEvent } from "../../domain/event";
import { classify, validateEvent } from "../../domain/event";

export class InMemoryEventStore implements EventStore {
  private readonly events: GameEvent[] = [];
  private readonly ids = new Set<string>();

  record(event: GameEvent): void {
    validateEvent(event); // reject any mislabeled (e.g. player-witnessed-but-hidden) event
    // Reject a DUPLICATE id (B40/audit C2): a restarted counter that re-mints an existing id would
    // silently corrupt the id-keyed superset checkpoint (0031) — fail loud instead of accepting it.
    if (this.ids.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    this.ids.add(event.id);
    this.events.push(event);
  }

  query(filter: EventQuery = {}): GameEvent[] {
    return this.events.filter((e) => {
      if (filter.witnessedBy !== undefined && classify(e, filter.witnessedBy) !== "VISIBLE") return false;
      if (filter.hidden !== undefined && e.hidden !== filter.hidden) return false;
      if (filter.type !== undefined && e.type !== filter.type) return false;
      return true;
    });
  }
}
