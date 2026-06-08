import type { EntityId } from "../domain/ids";
import type { KnowledgeFact, Suspicion } from "../domain/knowledge";

export interface KnowledgeService {
  /** Facts the entity may legitimately act on (witnessed-telling or surfaced). */
  knownTo(entity: EntityId): KnowledgeFact[];

  /** Hunches with no pathway. Never knowledge. */
  suspicionsOf(entity: EntityId): Suspicion[];

  /**
   * Surface a hidden fact to an entity through an in-game pathway. Records a
   * traceable surfacing event AND adds the fact to the entity's knowledge.
   */
  surfaceInformationTo(
    entity: EntityId,
    fact: { content: string; subject?: EntityId },
    pathway: string,
  ): KnowledgeFact;

  /** Give an entity a suspicion (no pathway, never promoted to knowledge here). */
  addSuspicion(entity: EntityId, fact: { content: string; subject?: EntityId }): Suspicion;

  /**
   * The player's Diary Room: player-level, OOC. Its content becomes the PLAYER's
   * own knowledge but has NO in-game pathway to any NPC.
   */
  recordDiaryRoom(content: string): KnowledgeFact;
}
