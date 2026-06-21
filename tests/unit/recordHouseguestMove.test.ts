import { describe, it, expect } from "vitest";
import { adrFixture } from "../support/adr0003";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * ADR 0009 — `recordHouseguestMove` (the engine half of "model narrates the open texture, engine
 * records it"). The contract:
 *   • a LEGAL narrated NPC relocation is recorded into the OPEN, player-facing occupancy (`presence`,
 *     read via `occupancy()` / `whereabouts()`);
 *   • it NEVER touches the calibration-neutral baseline (`presenceBase`, read via `societyOccupancy()`)
 *     — so every seeded society/comp/vote outcome is byte-identical (ADR 0005; mandate #3);
 *   • only a LEGAL move mutates — the player (own agency = `movePlayer`), an unknown/evicted
 *     houseguest, and a non-walkable/unresolvable room are refused (`illegal`), the "impossible claim"
 *     set the surface must instead catch before emission.
 * HARD rule: roles only — no names.
 */
describe("ADR 0009 — recordHouseguestMove (open-set record · calibration-neutral · legal-only)", () => {
  function seeded() {
    const fx = adrFixture("u-loc", 7);
    const s = fx.sb.session;
    let occ = s.occupancy();
    for (let i = 0; i < 6 && !occ; i++) { fx.orch.advance("u-loc", "offscreen-tick"); occ = s.occupancy(); } // seed presence
    const anNpc = [...occ!.keys()].find((id) => id !== PLAYER)!;
    return { s, anNpc };
  }
  // kitchen + backyard are both walkable and unambiguous; pick the one the NPC is NOT in → a real move.
  const otherRoom = (here: string) => (here === "kitchen" ? "backyard" : "kitchen");

  it("records a legal NPC move into the player-facing occupancy", () => {
    const { s, anNpc } = seeded();
    const dest = otherRoom(s.occupancy()!.get(anNpc)!);
    const res = s.recordHouseguestMove(anNpc, dest);
    expect(res.status).toBe("moved");
    expect(s.occupancy()!.get(anNpc)).toBe(dest);              // the open set now agrees with the prose
    expect(res.whereabouts).not.toBeNull();
  });

  it("NEVER mutates the calibration-neutral baseline (presenceBase ⇒ seeded society untouched)", () => {
    const { s, anNpc } = seeded();
    const baseBefore = s.societyOccupancy()!.get(anNpc);
    s.recordHouseguestMove(anNpc, otherRoom(s.occupancy()!.get(anNpc)!));
    expect(s.societyOccupancy()!.get(anNpc)).toBe(baseBefore); // baseline byte-identical (ADR 0005)
  });

  it("is a no-op when the houseguest is already in the room", () => {
    const { s, anNpc } = seeded();
    const here = s.occupancy()!.get(anNpc)!;
    expect(s.recordHouseguestMove(anNpc, here).status).toBe("noop");
    expect(s.occupancy()!.get(anNpc)).toBe(here);
  });

  it("refuses the player (their agency is movePlayer)", () => {
    const { s } = seeded();
    const playerHere = s.occupancy()!.get(PLAYER)!;
    expect(s.recordHouseguestMove(PLAYER, otherRoom(playerHere)).status).toBe("illegal");
    expect(s.occupancy()!.get(PLAYER)).toBe(playerHere);       // the player did not move
  });

  it("refuses an unknown / not-in-house houseguest", () => {
    const { s } = seeded();
    expect(s.recordHouseguestMove(npc(999), "kitchen").status).toBe("illegal");
  });

  it("refuses a non-walkable room (the diary room is a ceremony beat, never a hangout)", () => {
    const { s, anNpc } = seeded();
    const before = s.occupancy()!.get(anNpc);
    expect(s.recordHouseguestMove(anNpc, "diary room").status).toBe("illegal");
    expect(s.occupancy()!.get(anNpc)).toBe(before);            // unmoved
  });

  it("refuses an unresolvable room", () => {
    const { s, anNpc } = seeded();
    const before = s.occupancy()!.get(anNpc);
    expect(s.recordHouseguestMove(anNpc, "the moon").status).toBe("illegal");
    expect(s.occupancy()!.get(anNpc)).toBe(before);            // unmoved
  });
});
