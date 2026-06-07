// Pure domain types — no I/O, no dependencies.

export type HouseguestId = string;

/** The single, stable id for the human player within a game. */
export const PLAYER: HouseguestId = 'player';

/** One interaction in the single event record. Visibility is metadata on the event. */
export interface GameEvent {
  readonly id: string;
  readonly initiator: HouseguestId;
  /** Who was present. The player is just another possible member. */
  readonly witnessSet: ReadonlySet<HouseguestId>;
  /** Convenience flag; MUST agree with the witness set (see `classify`). */
  readonly hidden: boolean;
  readonly content: string;
  readonly ts: number;
}

export type Visibility = 'VISIBLE' | 'HIDDEN';

/**
 * Visibility is DERIVED from the witness set — never from which store the event lives in.
 * (Belongs to feature 0002; included here so 0001's fixtures can build realistic events
 * and the unit-test lane has something pure to exercise.)
 */
export function classify(event: GameEvent, entity: HouseguestId): Visibility {
  return event.witnessSet.has(entity) ? 'VISIBLE' : 'HIDDEN';
}
