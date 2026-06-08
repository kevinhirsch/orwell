import type { EventStore, EventQuery } from "../../ports/EventStore";
import type { GameEvent } from "../../domain/event";
import { classify, validateEvent } from "../../domain/event";

export class InMemoryEventStore implements EventStore {
  private readonly events: GameEvent[] = [];

  record(event: GameEvent): void {
    validateEvent(event); // reject any mislabeled (e.g. player-witnessed-but-hidden) event
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
