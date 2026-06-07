import type { EventStore } from '../../ports/EventStore';
import type { GameEvent } from '../../domain/types';

/** In-memory EventStore for tests and early development. SQLite adapter lands with persistence. */
export class InMemoryEventStore implements EventStore {
  private readonly events: GameEvent[] = [];

  record(event: GameEvent): void {
    this.events.push(event);
  }

  all(): readonly GameEvent[] {
    return this.events;
  }

  visibleTo(entity: string): readonly GameEvent[] {
    return this.events.filter((e) => e.witnessSet.has(entity));
  }
}
