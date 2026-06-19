/**
 * Presence assignment + overhearing (feature 0049). Seeded, relationship-weighted occupancy —
 * facts the narrator queries, not a simulation the player operates. Allies drift together,
 * the HOH gravitates upstairs, schemers find space — all through the seeded RandomnessSource
 * (same seed, same trajectories), with movement constrained to the floor plan.
 */
import { HOUSE_ROOMS, HOUSE_ADJACENCY, areAdjacent, type Room, type Occupancy } from "../domain/house";
import { PLAYER } from "../domain/ids";
import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { KnowledgeService } from "../ports/KnowledgeService";
import { PRESENCE } from "./presenceConstants";

export interface PresenceDeps {
  rng: RandomnessSource;
  /** Directed affinity read (0017/0026) — how much `a` wants to be around `b`. */
  affinity: (a: EntityId, b: EntityId) => number;
  hoh?: EntityId | null;
}

/**
 * Assign every ACTIVE houseguest exactly one room. With a previous occupancy, each houseguest
 * either stays put or moves to an ADJACENT room (no teleporting — ADR 0003 §8); the very first
 * assignment may place anyone anywhere. Deterministic for a given rng stream: iteration order
 * is the caller's `active` array (stable), choices come only from `rng`.
 */
export function assignRooms(
  active: readonly EntityId[],
  previous: Occupancy | null,
  deps: PresenceDeps,
  // PINNED houseguests are seated FIRST and never moved — the engine drives only `active`, but the
  // pinned still pull the movers (affinity clustering reads them). Used to hold the PLAYER in place
  // (a person, not engine-relocated — L21/L24) while NPCs may still gravitate to the player's room.
  pinned?: Occupancy | null,
): Map<EntityId, Room> {
  const next = new Map<EntityId, Room>(pinned ?? undefined);
  for (const id of active) {
    const here = previous?.get(id);
    // Candidate rooms: anywhere on first assignment; stay-or-adjacent afterwards. The diary
    // room is never a hangout (it is a booth, not a lounge).
    const candidates: readonly Room[] = (here
      ? [here, ...(HOUSE_ADJACENCY.get(here) ?? [])]
      : HOUSE_ROOMS
    ).filter((r) => r !== "diary-room");
    if (here && deps.rng.next() >= PRESENCE.moveProb) {
      next.set(id, here); // most ticks, most people stay where they are
      continue;
    }
    // Weight each candidate by who is already there (affinity pull) + the HOH-room pull.
    const weights = candidates.map((room) => {
      let w = 1;
      for (const [other, theirRoom] of next) {
        if (theirRoom === room) w += PRESENCE.affinityPull * deps.affinity(id, other);
      }
      if (room === "hoh-room") w = id === deps.hoh ? w + PRESENCE.hohRoomPull * 4 : w * PRESENCE.hohRoomPull;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = deps.rng.next() * total;
    let chosen = candidates[candidates.length - 1]!;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) { chosen = candidates[i]!; break; }
    }
    next.set(id, chosen);
  }
  return next;
}

/**
 * Roll the adjacency overhear for one resolved scene (BOTH directions by construction — the
 * listeners are simply whoever occupies an adjacent room, player or NPC). ONE gate per scene,
 * ONE ear when it opens (the player has priority — the flagship beat is player-centric): an
 * overhear is a RARE, special beat, not a chorus, and every one is a recorded propagation
 * event the persistence layer pays for. A success surfaces a PARTIAL, lower-confidence belief
 * through the real 0002 pathway (`overheard:<eventId>`), so every overhear is traceable —
 * eavesdropping is information-gathering, never narrative vibes. Returns who overheard.
 */
export function rollOverhears(deps: {
  eventId: string;
  room: Room;
  content: string;
  participants: readonly EntityId[];
  occupancy: Occupancy;
  knowledge: KnowledgeService;
  rng: RandomnessSource;
}): EntityId[] {
  const listeners: EntityId[] = [];
  for (const [id, where] of deps.occupancy) {
    if (deps.participants.includes(id)) continue; // you can't overhear your own scene
    if (!areAdjacent(where, deps.room)) continue; // walls work; only next door listens
    listeners.push(id);
  }
  if (listeners.length === 0) return [];
  if (deps.rng.next() >= PRESENCE.overhearProb) return []; // gated per scene, never guaranteed
  const who = listeners.includes(PLAYER) ? PLAYER : listeners[deps.rng.int(listeners.length)]!;
  // Partial by DESIGN and by construction: the overhearer catches a strict fragment (never the
  // whole line), so a hidden scene's full content can never reach anyone verbatim through a wall —
  // the orchestrator's vault-leak checkpoint (a full-content substring sweep) stays strict and green.
  const caught = deps.content.slice(0, Math.max(1, Math.floor(deps.content.length * PRESENCE.overhearFraction)));
  deps.knowledge.surfaceInformationTo(
    who,
    { content: `(overheard, muffled) ${caught}…`, confidence: PRESENCE.overhearConfidence },
    `overheard:${deps.eventId}`,
  );
  return [who];
}
