/**
 * Presence & overhearing tunables (feature 0049) — the single home for every number the
 * presence layer uses, in the 0026/0028 constants-module pattern (no magic numbers inline;
 * a future God-Mode knob).
 */
export interface PresenceConstants {
  /**
   * Chance a resolved scene is overheard AT ALL (one roll per scene, one ear when it opens).
   * Deliberately low: an overhear is a rare, special beat — and every success is a recorded
   * propagation event, so volume also costs persistence (the per-commit snapshot scales with
   * the event store).
   */
  overhearProb: number;
  /** Chance a houseguest moves rooms on a tick at all (otherwise they stay put). */
  moveProb: number;
  /** Weight of affinity toward already-placed occupants when choosing a room. */
  affinityPull: number;
  /** How strongly the HOH gravitates to the HOH room. */
  hohRoomPull: number;
  /** Confidence carried by an overheard fact (a witness's is full/unset; this is partial). */
  overhearConfidence: number;
  /** Fraction of a scene's content an overhearer catches (NEVER 1 — through a wall, not a transcript). */
  overhearFraction: number;
}

export const PRESENCE: PresenceConstants = {
  overhearProb: 0.1,
  moveProb: 0.6,
  affinityPull: 0.8,
  hohRoomPull: 0.5,
  overhearConfidence: 0.4,
  overhearFraction: 0.6,
};
