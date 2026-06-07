import type { EntityId } from "./ids";

/**
 * A fact an entity may legitimately act on. It entered the entity's knowledge
 * either by witnessing an event or via an in-game pathway (told / overheard /
 * caught) — recorded with that pathway for traceability.
 */
export interface KnowledgeFact {
  id: string;
  content: string;
  /** How it was learned: "witnessed" | "told-by:<id>" | "overheard" | "diary-room" ... */
  pathway: string;
  sourceEventId?: string;
  subject?: EntityId;
  ts: number;
}

export type KnowledgeState = readonly KnowledgeFact[];
