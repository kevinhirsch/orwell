import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

describe("0015/agent — engine-owned live competition resolution", () => {
  it("no game in progress → started:false, no winner, no throw", () => {
    const s = new GameSessionAdapter();
    const r = s.runCompetition({ type: "endurance" });
    expect(r.started).toBe(false);
    expect(r.winner).toBeNull();
  });

  it("resolves over the live house and returns only the winner's name (Vault-free)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 7 });
    const state = s.getGameState();
    const names = new Set([state.player!.name, ...state.house.map((h) => h.name)]);
    const ids = new Set([state.player!.id, ...state.house.map((h) => h.id)]);

    const r = s.runCompetition({ type: "endurance" });
    expect(r.started).toBe(true);
    expect(r.winner).not.toBeNull();
    expect(ids.has(r.winner!.id)).toBe(true);
    expect(names.has(r.winner!.name)).toBe(true);

    // The outcome carries ONLY {started,type,week,phase,winner:{id,name}} — no stats/scores/soul.
    const blob = JSON.stringify(r);
    for (const banned of ["physical", "mental", "social", "score", "soul", "stats", "emotional"]) {
      expect(blob.includes(banned)).toBe(false);
    }
  });

  it("is deterministic per moment (same week/phase/type → same winner)", () => {
    const a = new GameSessionAdapter(); a.createCharacter({ playerName: "P", seed: 42 });
    const b = new GameSessionAdapter(); b.createCharacter({ playerName: "P", seed: 42 });
    expect(a.runCompetition({ type: "puzzle" })).toEqual(b.runCompetition({ type: "puzzle" }));
  });

  it("an unknown competition type falls back to a valid one (no throw)", () => {
    const s = new GameSessionAdapter(); s.createCharacter({ playerName: "P", seed: 1 });
    const r = s.runCompetition({ type: "banana" });
    expect(r.started).toBe(true);
    expect(r.winner).not.toBeNull();
  });
});
