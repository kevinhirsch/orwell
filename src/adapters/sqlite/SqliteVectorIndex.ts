import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { VectorDimMismatchError, type VectorIndex, type VectorMatch } from "../../ports/VectorIndex";

/**
 * ENGINE-ONLY sqlite-vec vector index (E63 — the relational analogue of `InMemoryVectorIndex`, the
 * datastore plan's `sqlite-vec → pgvector` step). Cosine-similarity KNN recall over Vault-side soul
 * embeddings (0024). Like the Vault, no outward module may depend on it (dependency-cruiser).
 *
 * SYNCHRONOUS by construction — `better-sqlite3` + the sqlite-vec loadable extension are both
 * synchronous, so `upsert`/`query` keep the SoulStore seam synchronous (the fastembed `Atomics.wait`
 * bridge + the G8/G12 breathing lane depend on this; an async vector seam would break them).
 *
 * One INDEX = one `vec0` virtual TABLE. `SoulStore` builds one `VectorIndex` per houseguest via its
 * injected `makeIndex` factory, so a SHARED database hands out per-houseguest tables (a unique table
 * name per instance) — the same partition-per-soul isolation the in-memory map gives, in one db file.
 *
 * The vector DIMENSION is fixed at table creation and is not known until the first `upsert`, so the
 * `vec0` table is created LAZILY on the first inserted vector (its length). A later vector of a
 * different length is rejected — which is correct: mixing dimensions in one index is a bug (one
 * embedder, one space; ADR 0004 / engineRoot's space invariant) — PERSIST-1: rejected with an
 * explicit `VectorDimMismatchError` BEFORE it ever reaches sqlite-vec's own native reject, so the
 * failure signal is the same typed error `InMemoryVectorIndex` throws and `SoulStore` can catch and
 * self-heal on (rebuild the houseguest's index in the new space) rather than an opaque native
 * exception silently swallowed by an empty catch (the ORIGINAL PERSIST-1/PERSIST-6 finding).
 *
 * SCORE semantics MATCH `InMemoryVectorIndex`: the table uses `distance_metric=cosine`, and
 * `score = 1 - cosine_distance` is exactly cosine similarity (1 identical, 0 orthogonal, -1 opposite),
 * sorted descending — identical to the in-memory cosine sort, so recall results are equivalent.
 */
export class SqliteVectorIndex implements VectorIndex {
  private readonly table: string;
  private dim: number | null = null;
  private readonly db: DatabaseType;
  private readonly ownsDb: boolean;

  private static seq = 0;

  /**
   * @param db   A shared sqlite-vec-loaded database (the `makeIndex` factory passes one). When omitted,
   *             the index owns a private in-memory database (handy for a standalone index / tests).
   */
  constructor(db?: DatabaseType) {
    if (db) {
      this.db = db;
      this.ownsDb = false;
    } else {
      this.db = openVecDatabase(":memory:");
      this.ownsDb = true;
    }
    this.table = `vec_soul_${++SqliteVectorIndex.seq}`;
  }

  upsert(id: string, vector: readonly number[], meta?: Record<string, unknown>): void {
    this.ensureTable(vector.length);
    if (vector.length !== this.dim) throw new VectorDimMismatchError(this.dim!, vector.length, this.table);
    const buf = Buffer.from(new Float32Array(vector).buffer);
    const metaJson = meta ? JSON.stringify(meta) : null;
    // vec0 PRIMARY KEY rejects INSERT OR REPLACE, so upsert is delete-then-insert under one txn.
    const upsertTxn = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${this.table} WHERE mem_id = ?`).run(id);
      this.db.prepare(`INSERT INTO ${this.table}(mem_id, meta, embedding) VALUES (?, ?, ?)`).run(id, metaJson, buf);
    });
    upsertTxn();
  }

  query(vector: readonly number[], k: number): VectorMatch[] {
    if (this.dim === null || k <= 0) return [];
    if (vector.length !== this.dim) return []; // fail safe: not a comparable space (PERSIST-1)
    const buf = Buffer.from(new Float32Array(vector).buffer);
    const rows = this.db
      .prepare(
        `SELECT mem_id, distance FROM ${this.table} WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
      )
      .all(buf, k) as Array<{ mem_id: string; distance: number }>;
    // cosine distance → cosine similarity score, matching InMemoryVectorIndex's descending-cosine sort.
    return rows.map((r) => ({ id: r.mem_id, score: 1 - r.distance }));
  }

  /** Close a privately-owned database (no-op for a shared one — its owner closes it). */
  close(): void {
    if (this.ownsDb) this.db.close();
  }

  private ensureTable(dim: number): void {
    if (this.dim !== null) return;
    this.dim = dim;
    this.db.exec(
      `CREATE VIRTUAL TABLE ${this.table} USING vec0(` +
        `mem_id TEXT PRIMARY KEY, ` +
        `+meta TEXT, ` +
        `embedding float[${dim}] distance_metric=cosine` +
        `)`,
    );
  }
}

/**
 * Open a `better-sqlite3` database with the sqlite-vec extension loaded — the one place the native
 * extension is wired. A shared instance from here is passed to every per-houseguest `SqliteVectorIndex`.
 */
export function openVecDatabase(dbPath = ":memory:"): DatabaseType {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  sqliteVec.load(db);
  return db;
}

/**
 * A `makeIndex` factory for `SoulStore` (`() => VectorIndex`) backed by ONE shared sqlite-vec database
 * — each call returns a fresh per-houseguest `SqliteVectorIndex` (its own table) over that db, so the
 * whole house's recall lives in a single (in-memory by default) vector store. ENGINE-ONLY.
 */
export function sqliteVectorIndexFactory(dbPath = ":memory:"): () => VectorIndex {
  const db = openVecDatabase(dbPath);
  return () => new SqliteVectorIndex(db);
}
