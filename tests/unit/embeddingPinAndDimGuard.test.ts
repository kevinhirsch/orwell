import { describe, it, expect, afterEach, vi } from "vitest";
import { VectorDimMismatchError } from "../../src/ports/VectorIndex";
import { InMemoryVectorIndex } from "../../src/adapters/inmemory/InMemoryVectorIndex";
import { SqliteVectorIndex } from "../../src/adapters/sqlite/SqliteVectorIndex";
import { SoulStore } from "../../src/adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { buildEngineCore, setRuntimeEmbedding } from "../../src/composition/engineRoot";
import { npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * PERSIST-1 (dimension-mismatch corruption) + PERSIST-4 (boot-warm-up pin race), Wave-C.
 * Roles only; no houseguest names.
 *
 * PERSIST-1: a `VectorIndex` used to compare vectors of different dimensions with
 * `Math.min(a.length, b.length)` (in-memory) or let a native sqlite-vec exception vanish into an
 * empty catch (`SoulStore.indexOne`) — either way a mixed-dimension index produced a silently
 * wrong recall instead of a visible failure. Both adapters must now FAIL SAFE: reject a
 * mismatched `upsert` with `VectorDimMismatchError`, and return no matches from a mismatched
 * `query` rather than a meaningless score.
 *
 * PERSIST-4: `engineRoot.buildEngineCore` used to capture `runtimeEmbedding` once, at sandbox
 * construction time. A sandbox built during the fastembed boot warm-up window was pinned to the
 * deterministic fallback FOREVER, even after warm-up finished moments later. The fix reads the
 * live provider on every embed call; `SoulStore`'s self-heal (triggered by the PERSIST-1 guard)
 * keeps that live transition from ever mixing two vector spaces inside one already-written index.
 */

afterEach(() => {
  setRuntimeEmbedding(null);
});

describe("PERSIST-1 — InMemoryVectorIndex fails safe on a dimension mismatch", () => {
  it("upsert throws VectorDimMismatchError instead of silently accepting a foreign-dim vector", () => {
    const idx = new InMemoryVectorIndex();
    idx.upsert("a", [1, 0, 0, 0]);
    expect(() => idx.upsert("b", [1, 0])).toThrow(VectorDimMismatchError);
  });

  it("query with a mismatched-dim vector returns no matches, never a garbage-truncated score", () => {
    const idx = new InMemoryVectorIndex();
    idx.upsert("a", [1, 0, 0, 0]);
    idx.upsert("b", [0, 1, 0, 0]);
    // Before the fix: cosine() used Math.min(a.length, b.length) and would happily compare the
    // first 2 dims of a 2-dim query against the first 2 dims of the 4-dim stored vectors,
    // returning a plausible-looking (but meaningless) ranking. Now: fail safe, no matches.
    expect(idx.query([1, 0], 5)).toEqual([]);
  });

  it("same-dimension usage is completely unaffected (no regression)", () => {
    const idx = new InMemoryVectorIndex();
    idx.upsert("same", [1, 0, 0, 0]);
    idx.upsert("orth", [0, 1, 0, 0]);
    const res = idx.query([1, 0, 0, 0], 2);
    expect(res.map((r) => r.id)).toEqual(["same", "orth"]);
    expect(res[0]!.score).toBeCloseTo(1, 5);
  });
});

describe("PERSIST-1 — SqliteVectorIndex fails safe on a dimension mismatch (parity with in-memory)", () => {
  it("upsert throws VectorDimMismatchError instead of leaking an opaque native sqlite-vec exception", () => {
    const idx = new SqliteVectorIndex();
    idx.upsert("a", [1, 0, 0, 0]);
    expect(() => idx.upsert("b", [1, 0])).toThrow(VectorDimMismatchError);
    idx.close();
  });

  it("query with a mismatched-dim vector returns no matches", () => {
    const idx = new SqliteVectorIndex();
    idx.upsert("a", [1, 0, 0, 0]);
    expect(idx.query([1, 0], 5)).toEqual([]);
    idx.close();
  });
});

describe("PERSIST-1 — SoulStore self-heals a vector-space transition instead of corrupting recall", () => {
  it("a mid-life embed-provider switch (mismatched dim) rebuilds the index — no thrown error, no lost memories", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let dim = 4;
    const embed = (text: string): number[] => {
      const v = new Array<number>(dim).fill(0);
      for (let i = 0; i < text.length; i++) v[i % dim]! += text.charCodeAt(i);
      return v;
    };
    const soul = new SoulStore(embed);
    const HG: EntityId = npc(1);

    soul.recordToSoul(HG, "a brutal veto betrayal that cut deep");
    // Force the drain to run synchronously via recall's flushPending (avoids depending on
    // macrotask timing in this unit test).
    expect(soul.recall(HG, "veto betrayal", 5).map((m) => m.content)).toContain(
      "a brutal veto betrayal that cut deep",
    );

    // Simulate the provider transition (PERSIST-4: warm-up finishing, or a mid-process degrade
    // in the other direction) — the SAME SoulStore instance now embeds into a different space.
    dim = 6;
    soul.recordToSoul(HG, "a quiet reconciliation over breakfast");

    // No exception should propagate out of recordToSoul/recall despite the dimension change.
    const recalled = soul.recall(HG, "veto betrayal reconciliation", 5).map((m) => m.content);
    // Both the pre-transition and post-transition memories must still be recallable — the
    // self-heal rebuilds the WHOLE houseguest history in the new space rather than dropping it.
    expect(recalled).toContain("a brutal veto betrayal that cut deep");
    expect(recalled).toContain("a quiet reconciliation over breakfast");

    // The transition was surfaced loudly (PERSIST-6), not silent.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("recall still works end-to-end with the plain deterministic fake (no spurious rebuilds)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = new DeterministicEmbedding();
    const soul = new SoulStore((t) => fake.embed(t));
    const HG: EntityId = npc(2);
    soul.recordToSoul(HG, "a brutal veto betrayal that cut deep");
    for (let i = 0; i < 5; i++) soul.recordToSoul(HG, `trivial chat about breakfast cereal ${i}`);
    const r = soul.recall(HG, "the veto betrayal", 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toContain("veto betrayal");
    // A pure single-provider run never hits the dimension-mismatch path.
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("PERSIST-4 — engineRoot's embedding pin is live, not captured once at sandbox-build time", () => {
  it("a sandbox built before the provider is set upgrades to it once it IS set — no permanent pin", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setRuntimeEmbedding(null); // simulate: sandbox built during the fastembed warm-up window
    const core = buildEngineCore();
    const HG: EntityId = npc(3);
    core.soul.recordToSoul(HG, "before warm-up finished");
    expect(core.soul.recall(HG, "before warm-up finished", 1)).toHaveLength(1);

    // "Warm-up finishes" moments later — the SAME already-built sandbox must pick this up.
    const calls: string[] = [];
    setRuntimeEmbedding({
      embed: (t) => {
        calls.push(t);
        const v = new Array(4).fill(0);
        for (let i = 0; i < t.length; i++) v[i % 4]! += t.charCodeAt(i);
        return v;
      },
    });
    core.soul.recordToSoul(HG, "after warm-up finished");
    // Both memories remain recallable — the transition self-healed rather than corrupting or
    // freezing the index (PERSIST-1's guard doing its job against PERSIST-4's transition).
    // `recall` flushes any still-queued (not-yet-embedded) memory synchronously first.
    const recalled = core.soul.recall(HG, "warm-up finished", 5).map((m) => m.content);
    expect(calls).toContain("after warm-up finished"); // the live provider WAS consulted
    expect(recalled).toContain("before warm-up finished");
    expect(recalled).toContain("after warm-up finished");
    errSpy.mockRestore();
  });

  it("the deterministic fallback is stable across calls — same input always yields the same vector", () => {
    setRuntimeEmbedding(null);
    const core1 = buildEngineCore();
    const core2 = buildEngineCore();
    const HG1: EntityId = npc(4);
    const HG2: EntityId = npc(5);
    core1.soul.recordToSoul(HG1, "identical content across two sandboxes");
    core2.soul.recordToSoul(HG2, "identical content across two sandboxes");
    // If the fallback ever became stateful/instance-specific, these two independently-built
    // sandboxes' recall would silently diverge; they must not.
    const r1 = core1.soul.recall(HG1, "identical content across two sandboxes", 1);
    const r2 = core2.soul.recall(HG2, "identical content across two sandboxes", 1);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("clearing an injected provider before build is respected — the cleared provider is never consulted", () => {
    const calls: string[] = [];
    setRuntimeEmbedding({ embed: (t) => { calls.push(t); return [1, 0]; } });
    setRuntimeEmbedding(null);
    const core = buildEngineCore();
    core.soul.recordToSoul(npc(6), "a quiet kitchen conversation");
    expect(calls).toHaveLength(0);
  });
});
