import { describe, it, expect } from "vitest";
import { foldGenerativeConsequence, foldThirdPartyConsequence } from "../../src/engine/consequence";
import { RelationshipModel } from "../../src/engine/relationships";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * BE-101 — an unrecognized `direction`/`emphasis` on the ADR-0005 generative-consequence descriptor
 * must never crash the call or write NaN into the permanent relationship layer: the MCP boundary only
 * shape-guards these as strings (never enum membership), so a hallucinating/malformed caller can send
 * any string through. The fold functions must skip an edge that doesn't resolve to a known constant.
 */
describe("BE-101 — generative consequence: unrecognized direction/emphasis never crashes or corrupts", () => {
  it("foldGenerativeConsequence: an unrecognized direction is skipped, not thrown, not NaN-written", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    const before = { ...rel.edge(npc(1), PLAYER) };
    const moved = foldGenerativeConsequence(rel, rng, PLAYER, [
      { toward: npc(1), direction: "much-warmer" as never },
    ]);
    expect(moved.size).toBe(0);
    const after = rel.edge(npc(1), PLAYER);
    expect(after).toEqual(before);
    for (const v of Object.values(after)) expect(Number.isFinite(v as number)).toBe(true);
  });

  it("foldGenerativeConsequence: an unrecognized emphasis is skipped, not thrown, not NaN-written", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    const before = { ...rel.edge(npc(1), PLAYER) };
    expect(() =>
      foldGenerativeConsequence(rel, rng, PLAYER, [
        { toward: npc(1), direction: "warmer", emphasis: "extreme" as never },
      ]),
    ).not.toThrow();
    const after = rel.edge(npc(1), PLAYER);
    expect(after).toEqual(before);
  });

  it("foldGenerativeConsequence: a valid direction still folds normally alongside a rejected one", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    const before = rel.edge(npc(2), PLAYER).affinity;
    const moved = foldGenerativeConsequence(rel, rng, PLAYER, [
      { toward: npc(1), direction: "bogus-direction" as never },
      { toward: npc(2), direction: "warmer" },
    ]);
    expect(moved.has(npc(1))).toBe(false);
    expect(moved.has(npc(2))).toBe(true);
    expect(rel.edge(npc(2), PLAYER).affinity).toBeGreaterThan(before);
  });

  it("foldThirdPartyConsequence: an unrecognized direction is skipped, not thrown, not NaN-written", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    const holder = npc(1);
    const about = npc(2);
    const before = { ...rel.edge(holder, about) };
    expect(() =>
      foldThirdPartyConsequence(rel, rng, PLAYER, [holder], [
        { holder, about, direction: "much-cooler" as never },
      ]),
    ).not.toThrow();
    expect(rel.edge(holder, about)).toEqual(before);
  });
});

/**
 * BE-102 — `recordInteraction`'s `toward` (flat AND inside the ADR-0005 `consequence` descriptor)
 * used to bypass the B39 living-houseguest check entirely, letting a caller fold a relationship
 * change onto an evicted/jury houseguest (or an invented id) with no scene, no witness, no in-game
 * pathway — a side-channel that could tilt the deterministic jury vote. Every targeting mechanism
 * must be filtered against the same living set `initiator`/`witnessSet` already enforce.
 */
describe("BE-102 — recordInteraction: toward/consequence targets are living-only", () => {
  function adapter(): { cmd: EngineCommandsAdapter; rel: RelationshipModel } {
    const rel = new RelationshipModel(0.5);
    const cmd = new EngineCommandsAdapter(new InMemoryEventStore(), new InMemoryKnowledgeService(new InMemoryEventStore()), rel);
    cmd.setLivingProvider(() => [npc(1), npc(2)]); // npc:9 is NOT living (evicted/invented)
    return { cmd, rel };
  }

  it("a flat `toward` naming a non-living houseguest folds nothing onto them", () => {
    const { cmd, rel } = adapter();
    const before = { ...rel.edge(npc(9), PLAYER) };
    expect(() =>
      cmd.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "x", kind: "betrayal", toward: [npc(9)],
      }),
    ).not.toThrow();
    expect(rel.edge(npc(9), PLAYER)).toEqual(before); // no fold ever reached the non-living target
  });

  it("a `toward` mixing a living and a non-living id folds only the living one", () => {
    const { cmd, rel } = adapter();
    const beforeNonLiving = { ...rel.edge(npc(9), PLAYER) };
    const beforeLivingThreat = rel.edge(npc(1), PLAYER).threat;
    cmd.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "x", kind: "betrayal", toward: [npc(1), npc(9)],
    });
    expect(rel.edge(npc(9), PLAYER)).toEqual(beforeNonLiving);
    expect(rel.edge(npc(1), PLAYER).threat).toBeGreaterThan(beforeLivingThreat); // the living target still folded
  });

  it("consequence.edges[].toward naming a non-living houseguest is dropped from the generative fold", () => {
    const { cmd, rel } = adapter();
    const before = { ...rel.edge(npc(9), PLAYER) };
    cmd.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "x",
      consequence: { edges: [{ toward: npc(9), direction: "warmer" }] },
    });
    expect(rel.edge(npc(9), PLAYER)).toEqual(before);
  });

  it("consequence.aboutEdges[].about naming a non-living houseguest is dropped from the third-party fold", () => {
    const { cmd, rel } = adapter();
    const before = { ...rel.edge(npc(1), npc(9)) };
    cmd.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "x",
      consequence: { aboutEdges: [{ holder: npc(1), about: npc(9), direction: "more-threatened" }] },
    });
    expect(rel.edge(npc(1), npc(9))).toEqual(before);
  });
});
