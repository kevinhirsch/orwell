import { describe, it, expect } from "vitest";
import { SqliteVectorIndex, sqliteVectorIndexFactory } from "../../src/adapters/sqlite/SqliteVectorIndex";
import { SoulStore } from "../../src/adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { InMemoryVectorIndex } from "../../src/adapters/inmemory/InMemoryVectorIndex";
import { npc } from "../../src/domain/ids";

/**
 * E63 — the sqlite-vec vector index satisfies the `VectorIndex` port with cosine-similarity KNN that
 * MATCHES the in-memory adapter's semantics (higher score = more similar, descending sort), upserts in
 * place, and stays SYNCHRONOUS so the SoulStore seam (fastembed bridge / G8 breathing lane) is intact.
 */
describe("E63 — SqliteVectorIndex (sqlite-vec)", () => {
  it("returns nearest-first by cosine similarity (score: 1 identical, 0 orthogonal, -1 opposite)", () => {
    const idx = new SqliteVectorIndex();
    idx.upsert("same", [1, 0, 0, 0]);
    idx.upsert("orth", [0, 1, 0, 0]);
    idx.upsert("opp", [-1, 0, 0, 0]);
    const res = idx.query([1, 0, 0, 0], 3);
    expect(res.map((r) => r.id)).toEqual(["same", "orth", "opp"]);
    expect(res[0]!.score).toBeCloseTo(1, 5);
    expect(res[1]!.score).toBeCloseTo(0, 5);
    expect(res[2]!.score).toBeCloseTo(-1, 5);
    idx.close();
  });

  it("upsert REPLACES a vector in place (no duplicate rows for the same id)", () => {
    const idx = new SqliteVectorIndex();
    idx.upsert("a", [1, 0, 0, 0]);
    idx.upsert("b", [0, 1, 0, 0]);
    idx.upsert("a", [0, 1, 0, 0]); // a now points the other way
    const res = idx.query([0, 1, 0, 0], 5);
    expect(res).toHaveLength(2); // not 3 — "a" was replaced, not duplicated
    expect(res.map((r) => r.id).sort()).toEqual(["a", "b"]);
    idx.close();
  });

  it("k bounds the result count; query before any upsert is empty (no table yet)", () => {
    const idx = new SqliteVectorIndex();
    expect(idx.query([1, 0], 3)).toEqual([]);
    for (let i = 0; i < 5; i++) idx.upsert(`m${i}`, [Math.cos(i), Math.sin(i)]);
    expect(idx.query([1, 0], 2)).toHaveLength(2);
    expect(idx.query([1, 0], 0)).toEqual([]);
    idx.close();
  });

  it("ranks the same as the in-memory cosine index for the same data (equivalent recall)", () => {
    const vecs: Array<[string, number[]]> = [
      ["x", [0.9, 0.1, 0, 0]],
      ["y", [0.1, 0.9, 0, 0]],
      ["z", [0.3, 0.3, 0.9, 0]],
    ];
    const mem = new InMemoryVectorIndex();
    const sq = new SqliteVectorIndex();
    for (const [id, v] of vecs) { mem.upsert(id, v); sq.upsert(id, v); }
    const q = [0.8, 0.2, 0.1, 0];
    const memOrder = mem.query(q, 3).map((r) => r.id);
    const sqOrder = sq.query(q, 3).map((r) => r.id);
    expect(sqOrder).toEqual(memOrder);
    sq.close();
  });

  it("backs SoulStore recall through the factory — the salient old memory is retrieved", () => {
    const fake = new DeterministicEmbedding();
    const soul = new SoulStore((t) => fake.embed(t), sqliteVectorIndexFactory());
    const HG = npc(1);
    soul.recordToSoul(HG, "a brutal veto betrayal that cut deep");
    for (let i = 0; i < 8; i++) soul.recordToSoul(HG, `trivial chat about breakfast cereal ${i}`);
    const r = soul.recall(HG, "the veto betrayal", 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toContain("veto betrayal");
  });

  it("per-houseguest indexes are isolated (one shared db, one table each)", () => {
    const fake = new DeterministicEmbedding();
    const soul = new SoulStore((t) => fake.embed(t), sqliteVectorIndexFactory());
    soul.recordToSoul(npc(1), "npc one's private memory about the veto");
    soul.recordToSoul(npc(2), "npc two's unrelated kitchen chat");
    // A recall for npc(1) never surfaces npc(2)'s memory (separate per-houseguest tables).
    const r1 = soul.recall(npc(1), "veto", 3);
    expect(r1.every((m) => m.content.includes("npc one"))).toBe(true);
    const r2 = soul.recall(npc(2), "kitchen", 3);
    expect(r2.every((m) => m.content.includes("npc two"))).toBe(true);
  });
});
