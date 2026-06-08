import { describe, it, expect } from "vitest";
import { ConsequenceEngine, restoreMemory } from "../../src/engine/consequence";
import { RelationshipModel } from "../../src/engine/relationships";
import { chooseNominations } from "../../src/engine/season";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

function engine(seed = 1): ConsequenceEngine {
  return new ConsequenceEngine(new InMemoryEventStore(), new RelationshipModel(0.5), new SeededRandom(seed));
}

describe("0023 — consequence & memory loop", () => {
  it("a bonding action raises the NPC's hidden trust/affinity toward the player; betrayal reverses it", () => {
    const e = engine();
    const before = { ...e.relationships().edge(npc(1), PLAYER) };
    e.record({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "warm chat", kind: "bonding" });
    const afterBond = { ...e.relationships().edge(npc(1), PLAYER) };
    expect(afterBond.trust).toBeGreaterThan(before.trust);
    expect(afterBond.affinity).toBeGreaterThan(before.affinity);

    e.record({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "stab", kind: "betrayal" });
    const afterBetray = e.relationships().edge(npc(1), PLAYER);
    expect(afterBetray.trust).toBeLessThan(afterBond.trust);
    expect(afterBetray.threat).toBeGreaterThan(afterBond.threat);
  });

  it("is deterministic: same actions + seed → same hidden shift", () => {
    const run = () => {
      const e = engine(7);
      e.record({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "x", kind: "bonding" });
      e.record({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "y", kind: "betrayal" });
      return e.relationships().edge(npc(1), PLAYER);
    };
    expect(run()).toEqual(run());
  });

  it("a vote against the player is recorded and raises the voter's hidden threat toward the player", () => {
    const e = engine();
    const before = e.relationships().edge(npc(2), PLAYER).threat;
    e.recordVoteAgainstPlayer(npc(2), npc(3));
    expect(e.relationships().edge(npc(2), PLAYER).threat).toBeGreaterThan(before);
    expect(e.snapshot().events.some((ev) => ev.type === "vote")).toBe(true);
  });

  it("snapshot → restore is lossless and a superset (events + hidden state survive a 'restart')", () => {
    const e = engine();
    e.record({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "betrayal", kind: "betrayal" });
    for (let i = 0; i < 4; i++) e.record({ initiator: PLAYER, witnessSet: [PLAYER, npc(2)], content: "bond", kind: "bonding" });
    const snap = e.snapshot();

    const reloaded = restoreMemory(snap); // fresh stores — simulates a process restart
    expect(reloaded.snapshot().events).toEqual(snap.events);
    expect(reloaded.snapshot().events.length).toBeGreaterThanOrEqual(snap.events.length);
    expect(reloaded.relationships().edge(npc(1), PLAYER)).toEqual(e.relationships().edge(npc(1), PLAYER));
    expect(reloaded.relationships().bondStrength(npc(2), PLAYER)).toBe(e.relationships().bondStrength(npc(2), PLAYER));
  });

  it("a hidden distrust shift later drives behavior (the wronged HOH targets the player)", () => {
    const e = engine();
    e.record({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "blindside", kind: "betrayal" });
    const noms = chooseNominations(npc(1), [npc(1), PLAYER, npc(2), npc(3)], e.relationships());
    expect(noms).toContain(PLAYER); // the betrayed HOH nominates the player (threat-driven)
  });
});
