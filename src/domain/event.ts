import type { EntityId } from "./ids";

export type { EntityId } from "./ids";

/** Open string union — concrete event kinds grow with later features. */
export type EventType =
  | "conversation"
  | "confessional"
  | "competition"
  | "surfacing"
  | "house-event"
  | (string & {});

/**
 * The single interaction record. Visibility is PER-EVENT METADATA — a witness
 * set plus a hidden flag — not a function of which store the event lives in.
 */
export interface GameEvent {
  id: string;
  ts: number;
  type: EventType;
  initiator: EntityId;
  /** Who was present. The player is visible-state iff they are in this set. */
  witnessSet: readonly EntityId[];
  /** Off-screen flag. Invariant: an event the player witnessed is NEVER hidden. */
  hidden: boolean;
  content: string;
}

export type Visibility = "VISIBLE" | "HIDDEN";

/** Visibility is DERIVED from the witness set, never from the storage location. */
export function classify(event: GameEvent, entity: EntityId): Visibility {
  return event.witnessSet.includes(entity) ? "VISIBLE" : "HIDDEN";
}

export function isVisibleTo(event: GameEvent, entity: EntityId): boolean {
  return classify(event, entity) === "VISIBLE";
}
