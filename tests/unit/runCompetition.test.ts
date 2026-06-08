import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";

const PLAYER_NAME = "The Player";
function started(seed = 11): GameSessionAdapter {
  const s = new GameSessionAdapter();
  s.createCharacter({ playerName: PLAYER_NAME, seed });
  return s;
}

// The engine-decided competition (Vault-free: winner name only, no scores).
describe("GameSessionAdapter.runCompetition — branches", () => {
  it("on an unstarted game: not started, no winner", () => {
    const r = new GameSessionAdapter().runCompetition({ type: "physical" });
    expect(r.started).toBe(false);
    expect(r.winner).toBeNull();
  });

  it("default field is the whole house; returns a single winner (no scores)", () => {
    const r = started().runCompetition({ type: "physical" });
    expect(r.started).toBe(true);
    expect(r.winner).not.toBeNull();
    expect(Object.keys(r.winner!).sort()).toEqual(["id", "name"]);
    expect(r).not.toHaveProperty("scores");
  });

  it("an unknown competition type falls back to a sensible default type", () => {
    const r = started().runCompetition({ type: "banana-eating" });
    expect(r.type).toBe("endurance");
  });

  it("participantIds restricts the field — the winner is one of them", () => {
    const field = [PLAYER, npc(1), npc(2)];
    const r = started().runCompetition({ type: "mental", participantIds: field });
    expect(field).toContain(r.winner!.id);
  });

  it("a too-small participant set falls back to the whole house (still a winner)", () => {
    const r = started().runCompetition({ type: "social", participantIds: [PLAYER] });
    expect(r.started).toBe(true);
    expect(r.winner).not.toBeNull();
  });

  it("is deterministic for a given game + type", () => {
    const a = started(5).runCompetition({ type: "puzzle" });
    const b = started(5).runCompetition({ type: "puzzle" });
    expect(a.winner!.id).toBe(b.winner!.id);
  });
});
