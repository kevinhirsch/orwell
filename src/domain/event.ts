import type { EntityId } from "./ids";
import { PLAYER } from "./ids";

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
  /**
   * A houseguest's hidden element surfaced in this scene (B50's rare-reveal loop). STRUCTURAL —
   * the production richness gate (B54) counts reveals from the store instead of parsing content.
   */
  reveal?: boolean;
}

export type Visibility = "VISIBLE" | "HIDDEN";

/** Visibility is DERIVED from the witness set, never from the storage location. */
export function classify(event: GameEvent, entity: EntityId): Visibility {
  return event.witnessSet.includes(entity) ? "VISIBLE" : "HIDDEN";
}

export function isVisibleTo(event: GameEvent, entity: EntityId): boolean {
  return classify(event, entity) === "VISIBLE";
}

/**
 * Enforces the core visibility invariant: the `hidden` flag is a function of the
 * witness set relative to the player (the audience). A player-witnessed event is
 * NEVER hidden (the regression guard for the past mislabeling bug), and an event
 * the player did not witness is always hidden until surfaced. Stores call this on
 * write so a mislabeled event cannot be persisted.
 */
export function validateEvent(event: GameEvent): void {
  const playerWitnessed = event.witnessSet.includes(PLAYER);
  if (playerWitnessed && event.hidden) {
    throw new Error(`Invariant violation: a player-witnessed event must not be hidden (${event.id})`);
  }
  if (!playerWitnessed && !event.hidden) {
    throw new Error(`Invariant violation: an unwitnessed event must be hidden (${event.id})`);
  }
}
