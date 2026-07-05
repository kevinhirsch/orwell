import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/**
 * PERSIST-7 — the durable (`ORWELL_STORE=sqlite`) recall tier must actually PERSIST the vector index
 * to disk and RELOAD it on a process restart. Before this fix, `engineRoot` called the factory with
 * NO path, so the index was silently `:memory:` and every restart lost it (I5 non-degradation gap for
 * the store that exists specifically to be durable). These tests "restart" by opening a BRAND-NEW
 * factory over the SAME on-disk db file (a fresh factory resets the per-process table-sequence counter,
 * exactly as a real process restart would) and asserting recall survives WITHOUT re-embedding.
 *
 * Roles only; no houseguest names.
 */
describe("PERSIST-7 — sqlite-vec index survives a process restart (round-trip on a real db file)", () => {
  it("vectors written in one session are queryable from a fresh factory over the same file — no re-upsert", () => {
    const dir = mkdtempSync(join(tmpdir(), "orwell-persist7-"));
    const dbPath = join(dir, "orwell-vec.sqlite");
    const fake = new DeterministicEmbedding();
    const HG = npc(1);

    // --- session 1: write embeddings, prove recall engages ---
    const makeIndex1 = sqliteVectorIndexFactory(dbPath);
    const idx1 = makeIndex1(HG);
    idx1.upsert("m1", fake.embed("a brutal veto betrayal that cut deep"), { content: "betrayal" });
    idx1.upsert("m2", fake.embed("idle small talk about breakfast cereal"), { content: "cereal" });
    const before = idx1.query(fake.embed("the veto betrayal"), 1);
    expect(before).toHaveLength(1);
    expect(before[0]!.id).toBe("m1");

    // --- "restart": a brand-new factory over the SAME file (fresh per-process table counter) ---
    const makeIndex2 = sqliteVectorIndexFactory(dbPath);
    const idx2 = makeIndex2(HG); // must recover the persisted table + its pinned dimension
    // Query BEFORE any upsert in the new session — proves the ROWS persisted, not just the schema.
    const after = idx2.query(fake.embed("the veto betrayal"), 1);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe("m1");
    expect(after[0]!.score).toBeCloseTo(before[0]!.score, 5); // byte-identical vectors, identical score
  });

  it("SoulStore recall survives a restart when the persisted authoritative memories are reloaded", () => {
    // The full-restore path (GameSessionAdapter.rebuildSoulIndex) replays each houseguest's PERSISTED
    // soul.memory into a fresh SoulStore. With PERSIST-7 the underlying vector rows already exist on
    // disk, so the replay's upserts are idempotent — recall works either way, and the durable index is
    // no longer silently thrown away on every restart. This asserts the end-to-end round-trip.
    const dir = mkdtempSync(join(tmpdir(), "orwell-persist7-soul-"));
    const dbPath = join(dir, "orwell-vec.sqlite");
    const fake = new DeterministicEmbedding();
    const HG = npc(1);
    const NOTES = [
      "a brutal veto betrayal that cut deep",
      "a quiet reconciliation over coffee",
      "trivial chatter about the weather",
    ];

    // session 1 — record into a durable SoulStore
    const soul1 = new SoulStore((t) => fake.embed(t), sqliteVectorIndexFactory(dbPath));
    for (const n of NOTES) soul1.recordToSoul(HG, n);
    expect(soul1.recall(HG, "the veto betrayal", 1)[0]!.content).toBe(NOTES[0]);

    // "restart" — new SoulStore over the SAME db file; replay the persisted authoritative memories
    // (mirrors rebuildSoulIndex). Recall must still surface the salient old memory.
    const soul2 = new SoulStore((t) => fake.embed(t), sqliteVectorIndexFactory(dbPath));
    for (const n of NOTES) soul2.recordToSoul(HG, n); // idempotent replay from the persisted mirror
    const recalled = soul2.recall(HG, "the veto betrayal", 1);
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.content).toBe(NOTES[0]);
  });

  it("the DEFAULT in-memory factory stays ephemeral across factories (no behavior change)", () => {
    // Byte-identical to before: with no dbPath, each factory is its own private :memory: db, so a
    // 'restart' (new factory) legitimately starts empty — only the opted-in durable path persists.
    const fake = new DeterministicEmbedding();
    const HG = npc(1);
    const makeIndex1 = sqliteVectorIndexFactory(); // default :memory:
    makeIndex1(HG).upsert("m1", fake.embed("something memorable"));
    const makeIndex2 = sqliteVectorIndexFactory(); // a separate :memory: db
    expect(makeIndex2(HG).query(fake.embed("something memorable"), 1)).toEqual([]);
  });
});
