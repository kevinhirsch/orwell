/**
 * The house itself (feature 0049): canonical rooms + a static adjacency map, in the pure
 * domain core. Adjacency is DATA, not behavior — the same house every season (it doesn't
 * remodel), so presence facts ("who's here, who's one room over") have stable ground truth.
 * No I/O, no randomness: occupancy ASSIGNMENT lives in the engine (`src/engine/presence.ts`);
 * this module only knows the floor plan and the invariants.
 */
import type { EntityId } from "./ids";

export type Room =
  | "kitchen" | "living-room" | "backyard" | "bedroom-a" | "bedroom-b"
  | "hoh-room" | "bathroom" | "storage-room" | "diary-room";

export const HOUSE_ROOMS: readonly Room[] = [
  "kitchen", "living-room", "backyard", "bedroom-a", "bedroom-b",
  "hoh-room", "bathroom", "storage-room", "diary-room",
];

/**
 * The floor plan. Symmetric by construction (asserted by the unit tests): the living room is
 * the hub; the HOH room sits up its own stairs; the diary room opens off the living room and
 * adjoins nothing else (it is PRIVATE — overhearing the diary room is impossible by data).
 */
export const HOUSE_ADJACENCY: ReadonlyMap<Room, readonly Room[]> = new Map<Room, readonly Room[]>([
  ["living-room", ["kitchen", "backyard", "bedroom-a", "bedroom-b", "hoh-room", "bathroom", "diary-room"]],
  ["kitchen", ["living-room", "backyard", "storage-room"]],
  ["backyard", ["living-room", "kitchen"]],
  ["bedroom-a", ["living-room", "bathroom"]],
  ["bedroom-b", ["living-room", "bathroom"]],
  ["bathroom", ["living-room", "bedroom-a", "bedroom-b"]],
  ["hoh-room", ["living-room"]],
  ["storage-room", ["kitchen"]],
  ["diary-room", ["living-room"]],
]);

export function areAdjacent(a: Room, b: Room): boolean {
  return a !== b && (HOUSE_ADJACENCY.get(a) ?? []).includes(b);
}

export type Occupancy = ReadonlyMap<EntityId, Room>;

/**
 * The presence invariants (ADR 0003 §8 — people must make sense), as a checkable predicate:
 *  - every listed houseguest is in EXACTLY one room (Map shape guarantees ≤1; this checks =1);
 *  - movement from a previous assignment only crosses adjacency (or stays put).
 * Returns the violations so tests/checkpoints can name what broke.
 */
export function occupancyViolations(
  active: readonly EntityId[],
  occupancy: Occupancy,
  previous?: Occupancy,
): string[] {
  const problems: string[] = [];
  for (const id of active) {
    const room = occupancy.get(id);
    if (!room) { problems.push(`${id} occupies no room`); continue; }
    if (!HOUSE_ROOMS.includes(room)) problems.push(`${id} occupies unknown room ${room}`);
    const before = previous?.get(id);
    if (before && before !== room && !areAdjacent(before, room)) {
      problems.push(`${id} teleported ${before} → ${room}`);
    }
  }
  for (const id of occupancy.keys()) {
    if (!active.includes(id)) problems.push(`${id} occupies a room but is not active (evicted houseguests are nowhere)`);
  }
  return problems;
}
