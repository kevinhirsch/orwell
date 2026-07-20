import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { Room } from "../../src/domain/house";
import type { GameHouse } from "../../src/engine/characterFactory";

/**
 * Feature 0077 Phase 2 — whereabouts is SIGHTLINE-scoped, not raw adjacency. The privacy payoff: a
 * houseguest behind a CLOSED door one room over no longer leaks onto the player's ambient `nearby`
 * read; only occupants of rooms the player can actually SEE into appear. Roles only — no fixture names.
 */

function startedSession(seed: number): { session: GameSessionAdapter; npcIds: EntityId[] } {
  const session = new GameSessionAdapter();
  session.createCharacter({ playerName: "The Player", seed });
  const house = (session as unknown as { house: GameHouse }).house;
  // 0111: these tests poke the private presence map to exercise SIGHTLINE — clear the premiere's
  // gathered champagne-circle flag so `whereabouts` reads the seated presence, not the opening toast.
  (session as unknown as { live?: { champagneCircle?: string } }).live!.champagneCircle = undefined;
  return { session, npcIds: house.npcs.map((n) => n.id) };
}

/** Seat the player + named NPCs into specific rooms (test-only — drive the private presence map). */
function seat(session: GameSessionAdapter, seating: Array<[EntityId, Room]>): void {
  const presence = new Map<EntityId, Room>(seating);
  (session as unknown as { presence: Map<EntityId, Room> }).presence = presence;
}

describe("0077 whereabouts — eyeshot, not adjacency (closed rooms don't leak occupants)", () => {
  it("a houseguest behind a CLOSED door one room over is NOT on the player's nearby read", () => {
    const { session, npcIds } = startedSession(21);
    const [behindDoor, inSight] = npcIds;
    // The player stands in the hallway. A houseguest is in bedroom-a (ADJACENT to the hallway, but a
    // closed door — opaque); another is in the living room (which the hallway DOES see into).
    seat(session, [[PLAYER, "hallway"], [behindDoor!, "bedroom-a"], [inSight!, "living-room"]]);

    const w = session.whereabouts()!;
    const nearbyRooms = w.nearby.map((n) => n.room);
    // The hallway sees the living room — never the bedrooms it adjoins.
    expect(nearbyRooms).toContain("living-room");
    expect(nearbyRooms).not.toContain("bedroom-a");
    // The closed-room occupant never surfaces anywhere in the read (present or nearby).
    const everyoneSeen = [...w.present, ...w.nearby.flatMap((n) => n.present)].map((p) => p.id);
    expect(everyoneSeen).not.toContain(behindDoor);
    expect(everyoneSeen).toContain(inSight);
  });

  it("the open public core sees ACROSS itself — the whole crowd is visible, even past a direct door", () => {
    const { session, npcIds } = startedSession(22);
    const [a, b] = npcIds;
    // Player in the dining room; one houseguest in the backyard (visible across the open plan though
    // dining has no backyard DOOR), one in a bedroom (private — never visible).
    seat(session, [[PLAYER, "dining-room"], [a!, "backyard"], [b!, "bedroom-b"]]);

    const w = session.whereabouts()!;
    const seen = w.nearby.flatMap((n) => n.present).map((p) => p.id);
    expect(seen).toContain(a); // across the open core
    expect(seen).not.toContain(b); // behind a closed door
    expect(w.nearby.map((n) => n.room)).not.toContain("bedroom-b");
  });

  it("standing IN a private room, the player still sees no neighbor's occupants by proximity", () => {
    const { session, npcIds } = startedSession(23);
    const [a] = npcIds;
    // Player in bedroom-a (private). A houseguest in the hallway just outside — bedroom-a has NO
    // sightline out (closed door), so the player does not get an ambient read of the hallway crowd.
    seat(session, [[PLAYER, "bedroom-a"], [a!, "hallway"]]);

    const w = session.whereabouts()!;
    expect(w.nearby).toHaveLength(0); // a closed room sees nothing out
    expect(w.nearby.flatMap((n) => n.present)).toHaveLength(0);
  });
});
