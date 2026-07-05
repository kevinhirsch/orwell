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
 *
 * PERSIST-7: `ORWELL_STORE=sqlite` opts into this adapter specifically so semantic recall survives a
 * process restart WITHOUT the (correct, but expensive) O(events) full re-embed replay `SoulStore`'s
 * `rebuildSoulIndex` falls back to. That requires two things beyond just "a real db file on disk"
 * (`engineRoot.ts` now threads a real `dbPath` instead of the prior always-`:memory:` default):
 *
 *   1. A STABLE table name per logical index, so a fresh instance opened against the SAME db file
 *      after a restart lands on the SAME table instead of a brand-new empty one. `makeIndex` now
 *      passes the houseguest id through as `name`; `tableNameFor` derives a deterministic, sanitized
 *      table identifier from it. Omitting `name` (standalone/ad-hoc use, e.g. direct unit tests)
 *      keeps the prior ephemeral per-process-sequence naming — unchanged.
 *   2. Recovering the pinned DIMENSION on construction — a fresh instance doesn't know its own `dim`
 *      until an `upsert` happens, so without help `query` would read as empty even though the table
 *      already holds rows from a prior life. A small `vec_meta` bookkeeping table
 *      (`table_name → dim`) records the dimension at first `upsert`; the constructor looks itself up
 *      there when given a `name`, so `query` works immediately post-restart.
 */
export class SqliteVectorIndex implements VectorIndex {
  private readonly table: string;
  private dim: number | null = null;
  private readonly db: DatabaseType;
  private readonly ownsDb: boolean;

  private static seq = 0;

  /**
   * @param db    A shared sqlite-vec-loaded database (the `makeIndex` factory passes one). When
   *              omitted, the index owns a private in-memory database (handy for a standalone
   *              index / tests).
   * @param name  A stable identity for this index (e.g. a houseguest id). When given, the table
   *              name is deterministic and any dimension already pinned for it is recovered from
   *              `vec_meta` — so `query` works before this instance's own first `upsert` (PERSIST-7).
   *              Omitted ⇒ the prior ephemeral per-process-sequence table name (ad-hoc/test use).
   */
  constructor(db?: DatabaseType, name?: string) {
    if (db) {
      this.db = db;
      this.ownsDb = false;
    } else {
      this.db = openVecDatabase(":memory:");
      this.ownsDb = true;
    }
    this.table = name !== undefined ? tableNameFor(name) : `vec_soul_${++SqliteVectorIndex.seq}`;
    if (name !== undefined) {
      const row = this.db.prepare("SELECT dim FROM vec_meta WHERE table_name = ?").get(this.table) as
        | { dim: number }
        | undefined;
      if (row) this.dim = row.dim;
    }
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
    // IF NOT EXISTS: on a genuine restart against a persisted db, `vec_meta` recovery above already
    // set `this.dim` and this method returns before reaching here — but a belt-and-suspenders guard
    // costs nothing and protects against a meta row that predates a table (e.g. an interrupted write).
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING vec0(` +
        `mem_id TEXT PRIMARY KEY, ` +
        `+meta TEXT, ` +
        `embedding float[${dim}] distance_metric=cosine` +
        `)`,
    );
    this.db.prepare("INSERT OR REPLACE INTO vec_meta (table_name, dim) VALUES (?, ?)").run(this.table, dim);
  }
}

/** A valid, collision-safe SQLite identifier derived from an arbitrary stable name (e.g. an
 *  `EntityId` like `npc:3` or `player`) — every non-alphanumeric character becomes `_`. */
function tableNameFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return `vec_soul_${cleaned || "anon"}`;
}

/**
 * Open a `better-sqlite3` database with the sqlite-vec extension loaded — the one place the native
 * extension is wired. A shared instance from here is passed to every per-houseguest `SqliteVectorIndex`.
 * Also ensures the `vec_meta` bookkeeping table PERSIST-7 relies on to recover a named index's pinned
 * dimension across a restart.
 */
export function openVecDatabase(dbPath = ":memory:"): DatabaseType {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.exec("CREATE TABLE IF NOT EXISTS vec_meta (table_name TEXT PRIMARY KEY, dim INTEGER NOT NULL)");
  return db;
}

/**
 * A `makeIndex` factory for `SoulStore` backed by ONE shared sqlite-vec database — each call returns
 * a `SqliteVectorIndex` over that db, keyed by the optional stable `name` (`SoulStore` passes the
 * houseguest id) so the whole house's recall lives in a single vector store, persisted to `dbPath`
 * when one is given (PERSIST-7 — default `:memory:` preserves the prior ephemeral behavior for
 * callers/tests that don't opt into a real path). ENGINE-ONLY.
 *
 * @param freshStart  When true (SoulStore's dimension-mismatch self-heal, PERSIST-1/PERSIST-4), any
 *                     existing on-disk table + `vec_meta` row for `name` is dropped FIRST, so the
 *                     replacement index starts genuinely empty in the new embedding space instead of
 *                     recovering the old (now-incompatible) pinned dimension and looping on
 *                     `VectorDimMismatchError` for every re-embedded memory.
 */
export function sqliteVectorIndexFactory(dbPath = ":memory:"): (name?: string, freshStart?: boolean) => VectorIndex {
  const db = openVecDatabase(dbPath);
  return (name?: string, freshStart?: boolean) => {
    if (freshStart && name !== undefined) {
      const table = tableNameFor(name);
      db.exec(`DROP TABLE IF EXISTS ${table}`);
      db.prepare("DELETE FROM vec_meta WHERE table_name = ?").run(table);
    }
    return new SqliteVectorIndex(db, name);
  };
}
