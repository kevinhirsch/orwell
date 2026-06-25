import { describe, it, expect } from "vitest";
import {
  HOUSE_ROOMS, HOUSE_SIGHTLINE, HOUSE_ADJACENCY, areVisible, areAdjacent, isPrivateRoom, type Room,
} from "../../src/domain/house";

/**
 * Feature 0077 Phase 2 — the SIGHTLINE graph (eyeshot). Adjacency is who you can WALK to; sightline is
 * whose occupants you can SEE. The HARD invariants: the graph is symmetric + irreflexive; the OPEN
 * PUBLIC CORE (kitchen/living-room/dining-room/backyard) is a mutual-visibility CLIQUE; the living room
 * sees into the hallway mouth; and EVERY closed door (the three bedrooms, bathroom, lounge, HOH, storage,
 * diary) is opaque from outside — crucially, the hallway sees NONE of the bedrooms it adjoins. Roles
 * only; pure data, no rng.
 */

const PUBLIC_CORE: readonly Room[] = ["kitchen", "living-room", "dining-room", "backyard"];
const CLOSED: readonly Room[] = [
  "bedroom-a", "bedroom-b", "bedroom-c", "bathroom", "lounge", "hoh-room", "storage-room", "diary-room",
];

describe("0077 sightline — the graph is well-formed (symmetric, irreflexive)", () => {
  it("every room is in the sightline map; no self-sightline; sightline is symmetric", () => {
    for (const r of HOUSE_ROOMS) expect(HOUSE_SIGHTLINE.has(r), `${r} missing from sightline`).toBe(true);
    for (const [room, seen] of HOUSE_SIGHTLINE) {
      expect(seen).not.toContain(room); // irreflexive
      for (const s of seen) {
        expect(HOUSE_SIGHTLINE.get(s) ?? [], `${room}→${s} sightline not mirrored`).toContain(room);
      }
    }
  });
});

describe("0077 sightline — eyeshot is the privacy structure", () => {
  it("the public core is a mutual-visibility CLIQUE (open plan + glass to the yard)", () => {
    for (const a of PUBLIC_CORE) {
      for (const b of PUBLIC_CORE) {
        if (a === b) continue;
        expect(areVisible(a, b), `${a} should see across the open core to ${b}`).toBe(true);
      }
    }
    // sightline reaches PAST a direct door here: dining ⇄ backyard are visible without being adjacent.
    expect(areVisible("dining-room", "backyard")).toBe(true);
    expect(areAdjacent("dining-room", "backyard")).toBe(false);
  });

  it("the living room sees into the hallway mouth (movement is observable there)", () => {
    expect(areVisible("living-room", "hallway")).toBe(true);
    expect(areVisible("hallway", "living-room")).toBe(true);
  });

  it("EVERY closed room is opaque from outside — and the hallway sees none of its bedrooms", () => {
    for (const room of CLOSED) {
      expect(isPrivateRoom(room), `${room} should be private (opaque from outside)`).toBe(true);
      for (const other of HOUSE_ROOMS) {
        expect(areVisible(other, room), `${other} must not see into the closed ${room}`).toBe(false);
      }
    }
    // The hallway ADJOINS the bedrooms (you can walk in) but sightline does NOT penetrate the doors.
    for (const bed of ["bedroom-a", "bedroom-b", "bedroom-c"] as const) {
      expect(areAdjacent("hallway", bed)).toBe(true);
      expect(areVisible("hallway", bed)).toBe(false);
    }
  });

  it("the public core + hallway are the ONLY non-private rooms (privacy scarcity)", () => {
    const publicRooms = HOUSE_ROOMS.filter((r) => !isPrivateRoom(r));
    expect([...publicRooms].sort()).toEqual(
      [...PUBLIC_CORE, "hallway"].sort(),
    );
  });

  it("sightline never invents a link across a wall it does not belong to (no sightline without a real opening)", () => {
    // Each sightline edge is either inside the open core, or the living-room⇄hallway mouth — never
    // a closed-door penetration. (A loose structural check: every sightline pair is adjacent OR both
    // are in the open public core.)
    for (const [a, seen] of HOUSE_SIGHTLINE) {
      for (const b of seen) {
        const bothCore = PUBLIC_CORE.includes(a) && PUBLIC_CORE.includes(b);
        expect(bothCore || areAdjacent(a, b), `${a}→${b} sightline has no opening`).toBe(true);
      }
    }
  });
});
