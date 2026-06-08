import type { KnowledgeService } from "../../ports/KnowledgeService";
import type { EventStore } from "../../ports/EventStore";
import { PLAYER } from "../../domain/ids";
import type { EntityId } from "../../domain/ids";
import type { KnowledgeFact, Suspicion } from "../../domain/knowledge";

export class InMemoryKnowledgeService implements KnowledgeService {
  private readonly knowledge = new Map<EntityId, KnowledgeFact[]>();
  private readonly suspicions = new Map<EntityId, Suspicion[]>();
  private seq = 0;
  private tick = 0;

  constructor(
    private readonly events: EventStore,
    private readonly clock: () => number = () => ++this.tick,
  ) {}

  knownTo(entity: EntityId): KnowledgeFact[] {
    return [...(this.knowledge.get(entity) ?? [])];
  }

  suspicionsOf(entity: EntityId): Suspicion[] {
    return [...(this.suspicions.get(entity) ?? [])];
  }

  addSuspicion(entity: EntityId, fact: { content: string; subject?: EntityId }): Suspicion {
    const s: Suspicion = {
      id: `suspect:${++this.seq}`,
      content: fact.content,
      ts: this.clock(),
      ...(fact.subject !== undefined ? { subject: fact.subject } : {}),
    };
    const list = this.suspicions.get(entity) ?? [];
    list.push(s);
    this.suspicions.set(entity, list);
    return s;
  }

  surfaceInformationTo(
    entity: EntityId,
    fact: { content: string; subject?: EntityId },
    pathway: string,
  ): KnowledgeFact {
    const ts = this.clock();
    const sourceEventId = `evt:surface:${++this.seq}`;
    const witnessSet: EntityId[] = [entity];
    // The surfacing (the telling) is itself a recorded, traceable event.
    this.events.record({
      id: sourceEventId, ts, type: "surfacing",
      initiator: entity, witnessSet, hidden: !witnessSet.includes(PLAYER),
      content: `surfaced via ${pathway}`,
    });
    return this.pushKnown(entity, { content: fact.content, pathway, sourceEventId, ts, subject: fact.subject });
  }

  recordDiaryRoom(content: string): KnowledgeFact {
    const ts = this.clock();
    const sourceEventId = `evt:dr:${++this.seq}`;
    // Player-witnessed, OOC. Witness set is the player alone — no NPC pathway.
    this.events.record({
      id: sourceEventId, ts, type: "diary-room",
      initiator: PLAYER, witnessSet: [PLAYER], hidden: false,
      content: `[diary-room] ${content}`,
    });
    return this.pushKnown(PLAYER, { content, pathway: "diary-room", sourceEventId, ts });
  }

  private pushKnown(
    entity: EntityId,
    f: { content: string; pathway: string; sourceEventId: string; ts: number; subject?: EntityId },
  ): KnowledgeFact {
    const k: KnowledgeFact = {
      id: `know:${++this.seq}`,
      content: f.content,
      pathway: f.pathway,
      sourceEventId: f.sourceEventId,
      ts: f.ts,
      ...(f.subject !== undefined ? { subject: f.subject } : {}),
    };
    const list = this.knowledge.get(entity) ?? [];
    list.push(k);
    this.knowledge.set(entity, list);
    return k;
  }
}
