import type { EntityId } from "../domain/ids";
import type { KnowledgeFact } from "../domain/knowledge";

export interface KnowledgeService {
  /** Facts the entity may legitimately act on. */
  knownTo(entity: EntityId): KnowledgeFact[];
  /**
   * Surface a hidden fact to an entity through an in-game pathway. Records a
   * traceable surfacing event AND adds the fact to the entity's knowledge.
   */
  surfaceInformationTo(
    entity: EntityId,
    fact: { content: string; subject?: EntityId },
    pathway: string,
  ): KnowledgeFact;
}
