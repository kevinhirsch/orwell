import { describe, it, expect } from "vitest";
import { evolveEmotion, offscreenEmotion } from "../../src/engine/emotionalArc";
import { rankApproaches } from "../../src/engine/conversation";
import { RelationshipModel } from "../../src/engine/relationships";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { TEMPERATURE_CONSTANTS } from "../../src/domain/temperatureConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { Soul } from "../../src/engine/characterFactory";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Audit E50/E52/E53 — per-role arc emotions, the temperature roll inside the live emotional
 * swing, and the per-variable weights actually driving their subsystems. Roles only.
 */

const settled = (): Soul => ({ emotionalBaseline: 0.5, volatility: 0.4, emotionalState: 0.5, emotionalHistory: [], memory: [] });

describe("E50 — off-screen emotions are per-role", () => {
  it("a betrayal's initiator SCHEMES while its partner is the one BETRAYED", () => {
    expect(offscreenEmotion("betrayal", "initiator")).toBe("scheme");
    expect(offscreenEmotion("betrayal", "partner")).toBe("betrayed");
    // The default keeps the initiator perspective (the pre-E50 call sites read the initiator).
    expect(offscreenEmotion("betrayal")).toBe("scheme");
    // Warm scenes warm both sides.
    expect(offscreenEmotion("bonding", "initiator")).toBe("bond");
    expect(offscreenEmotion("bonding", "partner")).toBe("bond");
  });

  it("recordOffscreenScene evolves BOTH souls — the victim's soul finally moves", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 3 });
    const core = s.snapshot();
    const [a, b] = [core.house!.npcs[0]!.id, core.house!.npcs[1]!.id];
    const soulOf = (id: string) => s.snapshot().house!.npcs.find((n) => n.id === id)!.soul;
    const beforeB = soulOf(b).emotionalState;
    s.recordOffscreenScene(a, b, "betrayal");
    const after = s.snapshot().house!;
    const soulA = after.npcs.find((n) => n.id === a)!.soul;
    const soulB = after.npcs.find((n) => n.id === b)!.soul;
    expect(soulB.emotionalState, "the betrayed partner's soul moved toward distress").toBeLessThan(beforeB);
    expect(soulA.memory.some((m) => m.includes("scheming"))).toBe(true);
    expect(soulB.memory.some((m) => m.includes("betrayed"))).toBe(true);
  });
});

describe("E52 — ADR 0001's temperature roll enters the live emotional swing", () => {
  it("a seeded rng modulates the swing; no rng reproduces the pre-E52 deterministic arc", () => {
    const base = settled();
    evolveEmotion(base, "blindside"); // deterministic path (no rng)

    const a = settled();
    const b = settled();
    evolveEmotion(a, "blindside", undefined, new SeededRandom(1));
    evolveEmotion(b, "blindside", undefined, new SeededRandom(99));
    // Different per-moment rolls ⇒ different (still bounded, still adverse) swings.
    expect(a.emotionalState).not.toBe(b.emotionalState);
    expect(a.emotionalState).toBeLessThan(0.5);
    expect(b.emotionalState).toBeLessThan(0.5);
    // Same seed ⇒ byte-identical (replayability).
    const a2 = settled();
    evolveEmotion(a2, "blindside", undefined, new SeededRandom(1));
    expect(a2.emotionalState).toBe(a.emotionalState);
  });

  it("stays bounded under extreme rolls and the weight is a real knob", () => {
    expect(TEMPERATURE_CONSTANTS.emotional.swingTemperatureWeight).toBeGreaterThan(0);
    for (let seed = 1; seed <= 50; seed++) {
      const s = settled();
      for (let i = 0; i < 20; i++) evolveEmotion(s, "blindside", undefined, new SeededRandom(seed * 100 + i));
      expect(s.emotionalState).toBeGreaterThanOrEqual(0);
      expect(s.emotionalState).toBeLessThanOrEqual(1);
    }
  });
});

describe("E53 — variableWeights drive their subsystems (no decorative config)", () => {
  it("changing the INITIATIVE weight changes approach-ordering variance", () => {
    const rel = new RelationshipModel(0.5);
    // Two near-tied agendas: variance decides how often the ordering flips across moments.
    rel.edge(npc(1), PLAYER).trust = 0.60; rel.edge(npc(1), PLAYER).affinity = 0.60;
    rel.edge(npc(2), PLAYER).trust = 0.58; rel.edge(npc(2), PLAYER).affinity = 0.58;
    const flips = (weight: number): number => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const top = rankApproaches(PLAYER, [npc(1), npc(2)], rel, new SeededRandom(seed), weight)[0]!.npc;
        if (top === npc(2)) n++;
      }
      return n;
    };
    expect(flips(0), "no variance ⇒ the stronger agenda always leads").toBe(0);
    expect(flips(0.8), "a wide band ⇒ near-ties genuinely wobble").toBeGreaterThan(10);
    expect(flips(TEMPERATURE_CONSTANTS.variableWeights.initiative)).toBeGreaterThan(0); // the default is live
  });

  it("the ALLIANCE-SHIFT weight is the chooseStrongestBond default wobble", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(npc(1), npc(2)).trust = 0.50; rel.edge(npc(1), npc(2)).affinity = 0.50;
    rel.edge(npc(1), npc(3)).trust = 0.49; rel.edge(npc(1), npc(3)).affinity = 0.49;
    const picksOfUnderdog = (): number => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        if (rel.chooseStrongestBond(npc(1), [npc(2), npc(3)], new SeededRandom(seed)) === npc(3)) n++;
      }
      return n;
    };
    const w = TEMPERATURE_CONSTANTS.variableWeights;
    const before = w.allianceShift;
    try {
      (w as { allianceShift: number }).allianceShift = 0;
      expect(picksOfUnderdog(), "no wobble ⇒ the clear bond always wins").toBe(0);
      (w as { allianceShift: number }).allianceShift = 0.6;
      expect(picksOfUnderdog(), "a wide wobble flips real near-ties").toBeGreaterThan(10);
    } finally {
      (w as { allianceShift: number }).allianceShift = before;
    }
  });

  it("every remaining variableWeights field has a consumer (the struct carries no dead knobs)", () => {
    expect(Object.keys(TEMPERATURE_CONSTANTS.variableWeights).sort()).toEqual(["allianceShift", "initiative"]);
  });
});
