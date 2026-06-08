import type { EntityId } from "../domain/ids";
import type { KnowledgeFact, Suspicion } from "../domain/knowledge";

/** A belief as it travels NPC-to-NPC: lineage + provenance + confidence + drift. */
export interface BeliefInput {
  content: string;
  factId: string;
  originalContent?: string;
  confidence?: number;
  source?: EntityId;
  hops?: number;
  distortion?: number;
  subject?: EntityId;
}

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

  /** Seed an origin belief on an entity (no telling event — they already knew it). */
  seedBelief(entity: EntityId, fact: BeliefInput, pathway: string): KnowledgeFact;

  /**
   * One retelling along the social graph: records the telling as its own event
   * (witnessed by teller + listener) and lodges the (possibly distorted) belief
   * in the listener's knowledge with its provenance and confidence.
   */
  transmitGossip(from: EntityId, to: EntityId, fact: BeliefInput, pathway: string): KnowledgeFact;
}
