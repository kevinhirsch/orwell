import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { isPrivateRoom, type Room } from "../../src/domain/house";

/**
 * Post-0085 diagnostic fix: the player ENTERS the social heart of the house, never a seeded dead-end
 * private room (a passive player stranded in the bathroom saw an empty house all season). They start in
 * the living room — public, sightline-rich — across seeds. Player-slot override only ⇒ calibration-safe.
 */
describe("player start room — the social heart, not a dead-end", () => {
  it("starts the player in the living room (a public, non-private room) regardless of seed", () => {
    for (const seed of [7, 13, 21, 42, 99]) {
      const s = new GameSessionAdapter();
      s.createCharacter({ playerName: "The Player", seed });
      const room = s.whereabouts()!.room as Room;
      expect(room).toBe("living-room");
      expect(isPrivateRoom(room)).toBe(false);
    }
  });
});
