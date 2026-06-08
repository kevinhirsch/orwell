import type { EventStore } from "../ports/EventStore";
import type { KnowledgeService } from "../ports/KnowledgeService";
import type { EntityId } from "../domain/ids";
import type { GameEvent } from "../domain/event";
import type { KnowledgeFact, Suspicion } from "../domain/knowledge";

export interface VisibleState {
  forEntity: EntityId;
  visibleEvents: GameEvent[];
  knowledge: KnowledgeFact[];
}

/**
 * The ONLY state source for outward channels. It reads the non-Vault
 * `EventStore` (filtered to events the entity witnessed) plus the entity's
 * `KnowledgeState`. It has no handle to the Vault — there is no method, and no
 * dependency, by which Vault data could enter the visible projection.
 */
export class VisibleStateService {
  constructor(
    private readonly events: EventStore,
    private readonly knowledge: KnowledgeService,
  ) {}

  getVisibleStateFor(entity: EntityId): VisibleState {
    return {
      forEntity: entity,
      visibleEvents: this.events.query({ witnessedBy: entity }),
      knowledge: this.knowledge.knownTo(entity),
    };
  }

  /**
   * The entity's pathway-free hunches. Non-Vault: a suspicion is, by definition,
   * a belief with no in-game pathway — it carries no Vault content. A social read
   * (0012) may hint at these without naming any off-screen event.
   */
  suspicionsFor(entity: EntityId): Suspicion[] {
    return this.knowledge.suspicionsOf(entity);
  }
}
