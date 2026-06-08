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

/**
 * A hunch an entity holds with NO in-game pathway to back it. A suspicion is
 * never knowledge — it can never be acted on as fact — until a pathway surfaces
 * the real thing and promotes it to a `KnowledgeFact`.
 */
export interface Suspicion {
  id: string;
  content: string;
  subject?: EntityId;
  ts: number;
}
