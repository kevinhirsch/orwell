import { describe, it, expect } from "vitest";
import { npcInitiatedApproaches, rankApproaches, npcExpress, npcCanAssert } from "../../src/engine/conversation";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { buildSandbox } from "../support/sandbox";
import { assertNoSentinels } from "../support/assertions";
import { PLAYER, npc } from "../../src/domain/ids";

describe("0012 — bidirectional NPC initiation", () => {
  const npcs = [npc(1), npc(2), npc(3), npc(4), npc(5)];

  function relWith(strongAlly: string, rival: string): RelationshipModel {
    const rel = new RelationshipModel(0.5);
    // strongAlly has a warm bond toward the player; rival reads the player as a threat;
    // the rest are lukewarm. Both ally and rival have a real agenda to approach.
    rel.edge(strongAlly, PLAYER).trust = 0.9;
    rel.edge(strongAlly, PLAYER).affinity = 0.9;
    rel.edge(rival, PLAYER).threat = 0.85;
    return rel;
  }

  it("approaches are relationship-driven (agenda), not chance", () => {
    const rel = relWith(npc(2), npc(4));
    for (let seed = 1; seed <= 25; seed++) {
      const approachers = npcInitiatedApproaches(PLAYER, npcs, rel, new SeededRandom(seed), 3);
      expect(approachers.length).toBe(3);
      // The warm ally and the threatened rival both have a clear agenda — they
      // surface as approachers regardless of the per-moment temperature roll.
      expect(approachers).toContain(npc(2));
      expect(approachers).toContain(npc(4));
    }
  });

  it("same seed reproduces the same approaches (deterministic, not random)", () => {
    const rel = relWith(npc(2), npc(4));
    const a = npcInitiatedApproaches(PLAYER, npcs, rel, new SeededRandom(7), 3);
    const b = npcInitiatedApproaches(PLAYER, npcs, rel, new SeededRandom(7), 3);
    expect(a).toEqual(b);
  });

  it("the strongest relationship drives the top approach", () => {
    const rel = relWith(npc(3), npc(1));
    const ranked = rankApproaches(PLAYER, npcs, rel, new SeededRandom(3));
    expect([npc(3), npc(1)]).toContain(ranked[0]!.npc);
  });

  it("each approach carries the coarse motive of its winning agenda (E60: bond vs probe)", () => {
    const rel = relWith(npc(2), npc(4));
    const ranked = rankApproaches(PLAYER, npcs, rel, new SeededRandom(9));
    const byNpc = new Map(ranked.map((a) => [a.npc, a.motive]));
    expect(byNpc.get(npc(2))).toBe("bond"); // the warm ally approaches over the tie
    expect(byNpc.get(npc(4))).toBe("probe"); // the wary rival approaches to size up
    for (const a of ranked) expect(["bond", "probe"]).toContain(a.motive);
  });
});

describe("0012 — an NPC only voices what it legitimately knows", () => {
  const fact = { content: "the HOH plans a backdoor" };

  it("asserts a known fact", () => {
    expect(npcCanAssert(fact, [fact])).toBe(true);
    expect(npcExpress(fact, [fact])).toEqual({ mode: "assert", content: fact.content });
  });

  it("never asserts a fact it has no pathway to — at most suspicion", () => {
    // Neither witnessed nor told, but suspected → hedged suspicion, never assertion.
    const suspected = npcExpress(fact, [], [fact]);
    expect(suspected.mode).toBe("suspect");
    expect(suspected.mode).not.toBe("assert");
    // No knowledge and no suspicion → silent. Still never an assertion.
    const blank = npcExpress(fact, [], []);
    expect(blank.mode).toBe("silent");
    expect(npcCanAssert(fact, [])).toBe(false);
  });
});

describe("0012 — social read is honest and Vault-free", () => {
  it("returns a read, hints when something is suspected, and never leaks a sentinel", () => {
    const sb = buildSandbox(1);
    const plain = sb.player.socialRead();
    expect(plain.length).toBeGreaterThan(0);
    assertNoSentinels(plain, sb.sentinels);

    // A pathway-free hunch makes the read hint at a shift — without naming it.
    sb.engine.knowledge.addSuspicion(PLAYER, { content: "an alliance may be forming" });
    const hinted = sb.player.socialRead(npc(1));
    expect(hinted).toMatch(/unsettled|isn't telling you everything/i);
    assertNoSentinels(hinted, sb.sentinels);
    // Even with the hunch present, no off-screen Vault content is named.
    for (const c of sb.hiddenContents) expect(hinted.includes(c)).toBe(false);
  });

  it("names the target houseguest, never echoes a raw id (play-through fix)", () => {
    // Bug: socialRead(target) interpolated the raw EntityId into player prose ("your read on
    // npc:3"). The live registry wires a public name resolver; the surface must use it and never
    // surface an `npc:N` id. Without a resolver it falls back to a generic noun, still no raw id.
    const sb = buildSandbox(1);
    const noResolver = sb.player.socialRead(npc(3));
    expect(noResolver).not.toMatch(/npc:\d/);

    sb.player.setNameResolver((id) => (id === npc(3) ? "A Houseguest Name" : undefined));
    const named = sb.player.socialRead(npc(3));
    expect(named).toContain("A Houseguest Name");
    expect(named).not.toMatch(/npc:\d/);

    // A resolver that (wrongly) returns an id-shaped string is still scrubbed to the generic noun.
    sb.player.setNameResolver(() => "npc:9");
    expect(sb.player.socialRead(npc(3))).not.toMatch(/npc:\d/);
  });
});
