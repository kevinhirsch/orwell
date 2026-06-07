import type { KnowledgeService } from "../../ports/KnowledgeService";
import type { EventStore } from "../../ports/EventStore";
import type { EntityId } from "../../domain/ids";
import type { KnowledgeFact } from "../../domain/knowledge";

export class InMemoryKnowledgeService implements KnowledgeService {
  private readonly byEntity = new Map<EntityId, KnowledgeFact[]>();
  private seq = 0;
  private tick = 0;

  constructor(
    private readonly events: EventStore,
    private readonly clock: () => number = () => ++this.tick,
  ) {}

  knownTo(entity: EntityId): KnowledgeFact[] {
    return [...(this.byEntity.get(entity) ?? [])];
  }

  surfaceInformationTo(
    entity: EntityId,
    fact: { content: string; subject?: EntityId },
    pathway: string,
  ): KnowledgeFact {
    const ts = this.clock();
    const id = `know:${++this.seq}`;
    const surfacingEventId = `evt:surface:${this.seq}`;

    // The surfacing is itself a recorded, traceable event (who learned it, when,
    // and by which pathway) — the player witnessed the telling.
    this.events.record({
      id: surfacingEventId,
      ts,
      type: "surfacing",
      initiator: entity,
      witnessSet: [entity],
      hidden: false,
      content: `surfaced via ${pathway}`,
    });

    const known: KnowledgeFact = {
      id,
      content: fact.content,
      pathway,
      sourceEventId: surfacingEventId,
      ts,
      ...(fact.subject !== undefined ? { subject: fact.subject } : {}),
    };
    const list = this.byEntity.get(entity) ?? [];
    list.push(known);
    this.byEntity.set(entity, list);
    return known;
  }
}
