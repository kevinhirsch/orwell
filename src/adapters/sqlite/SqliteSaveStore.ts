import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { UserSaveStore } from "../../ports/UserSaveStore";
import type { SessionSnapshot } from "../../engine/sessionSnapshot";

/**
 * SQLite-backed, per-user durable `UserSaveStore` (E63 — the relational adapter the datastore plan
 * has always pointed at: `better-sqlite3 → Postgres`). Same SEMANTICS as `FileSaveStore`:
 *
 *  - VERSIONED blobs: every save is a NEW row `(user, version, snapshot_json, created_at)` —
 *    a version is NEVER overwritten; `loadLatest` reads the highest version for the user.
 *  - DURABLE: the insert + version pick run inside a single SQLite TRANSACTION (atomic, WAL +
 *    `synchronous=FULL` so a committed save survives power loss — the fsync equivalent of
 *    `FileSaveStore`'s temp-write/fsync/rename dance).
 *  - LOSSLESS round-trip (non-degradation mandate #4): the snapshot is stored as exact JSON and
 *    parsed back unchanged, so superset + monotonic-count + byte-stable-character all hold.
 *  - PER-USER isolation (0021): rows are keyed by the user id (a bound parameter, never a path
 *    segment), so one user can never read another's saves AND no user string touches the filesystem.
 *  - Season RESTART (E1/R1): `resetUser` RETIRES the user's rows off the live path (a row rename, the
 *    relational analogue of `FileSaveStore`'s dir rotation) so `hasSave` goes false and the new
 *    season's history starts clean — an engine restart resumes season 2, never the dead one. The
 *    retired rows stay in the table (non-degradation: the record is preserved for inspection).
 *
 * `better-sqlite3` is SYNCHRONOUS, so this preserves the synchronous save/resume seam exactly — no
 * async leaks into the engine (the fastembed bridge + the G8/G12 breathing lane depend on it).
 *
 * ENGINE-ONLY (persists souls + the hidden relationship layer), like `FileSaveStore` — no outward
 * module may import it (dependency-cruiser, the same rule that walls `VaultStore`/`SoulProvider`).
 */
export class SqliteSaveStore implements UserSaveStore {
  /** Newest versions always retained (the working window incl. crash-recovery slack). Mirrors FileSaveStore. */
  private static readonly RETAIN_RECENT = 5;
  /** Every Nth version is a periodic checkpoint... */
  private static readonly CHECKPOINT_EVERY = 50;
  /** ...of which only the newest few are retained (the long-tail archive stays bounded). */
  private static readonly RETAIN_CHECKPOINTS = 3;

  private readonly db: DatabaseType;
  private readonly stmtMaxVersionAny: Statement;
  private readonly stmtInsert: Statement;
  private readonly stmtLoadLatest: Statement;
  private readonly stmtHasSave: Statement;
  private readonly stmtListUsers: Statement;
  private readonly stmtRetire: Statement;
  private readonly saveTxn: (user: string, json: string) => void;

  /**
   * @param dbPath  SQLite file path (default `<ORWELL_DATA_DIR>/orwell.sqlite`). `:memory:` for tests.
   */
  constructor(dbPath?: string) {
    const path =
      dbPath ??
      `${(process.env.ORWELL_DATA_DIR ?? process.env.BBAI_DATA_DIR ?? "./.orwell-data").replace(/\/+$/, "")}/orwell.sqlite`;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    // Durability + concurrency: WAL for crash-safe append, FULL sync so a committed save is on disk.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saves (
        user          TEXT    NOT NULL,
        version       INTEGER NOT NULL,
        snapshot_json TEXT    NOT NULL,
        created_at    INTEGER NOT NULL,
        retired       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user, version)
      );
      CREATE INDEX IF NOT EXISTS saves_live ON saves (user, retired, version);
    `);
    // Next-version source: MAX over ALL rows (live + retired). Versions are GLOBALLY MONOTONIC per user
    // so a season restart (which retires, never deletes, the prior rows) can never collide on the
    // `(user, version)` primary key. `loadLatest`/`hasSave` still read LIVE rows, so the live "version"
    // a resume sees still restarts its working window after a reset (latest-live drops to 0).
    this.stmtMaxVersionAny = this.db.prepare("SELECT MAX(version) AS v FROM saves WHERE user = ?");
    this.stmtInsert = this.db.prepare(
      "INSERT INTO saves (user, version, snapshot_json, created_at, retired) VALUES (?, ?, ?, ?, 0)",
    );
    this.stmtLoadLatest = this.db.prepare(
      "SELECT version, snapshot_json FROM saves WHERE user = ? AND retired = 0 ORDER BY version DESC",
    );
    this.stmtHasSave = this.db.prepare(
      "SELECT 1 FROM saves WHERE user = ? AND retired = 0 LIMIT 1",
    );
    this.stmtListUsers = this.db.prepare(
      "SELECT DISTINCT user FROM saves WHERE retired = 0",
    );
    this.stmtRetire = this.db.prepare(
      "UPDATE saves SET retired = 1 WHERE user = ? AND retired = 0",
    );
    // Atomic versioned insert (E2/E8 analogue): pick the next version (globally monotonic per user) and
    // insert under one lock, so two concurrent saves can never collide on a version (the PRIMARY KEY
    // would reject it anyway, but the transaction makes the pick+insert a single durable step).
    this.saveTxn = this.db.transaction((user: string, json: string) => {
      const nextVersion = ((this.stmtMaxVersionAny.get(user) as { v: number | null }).v ?? 0) + 1;
      this.stmtInsert.run(user, nextVersion, json, Date.now());
      this.prune(user, nextVersion);
    });
  }

  saveFor(user: string, snapshot: SessionSnapshot): void {
    this.saveTxn(user, JSON.stringify(snapshot));
  }

  hasSave(user: string): boolean {
    return this.stmtHasSave.get(user) !== undefined;
  }

  /**
   * The newest READABLE save (live rows only). A row whose JSON fails to parse is QUARANTINED (retired,
   * so it can never be "latest" again → no restart crash-loop) and we step down to the next-lower
   * version. Returns null only when no live version parses (⇒ a fresh sandbox). Mirrors FileSaveStore.
   */
  loadLatest(user: string): SessionSnapshot | null {
    const rows = this.stmtLoadLatest.all(user) as Array<{ version: number; snapshot_json: string }>;
    for (const row of rows) {
      try {
        return JSON.parse(row.snapshot_json) as SessionSnapshot;
      } catch {
        // Quarantine the corrupt version (retire it) and try the next-lower one.
        try {
          this.db.prepare("UPDATE saves SET retired = 1 WHERE user = ? AND version = ?").run(user, row.version);
        } catch { /* best-effort quarantine */ }
      }
    }
    return null;
  }

  /**
   * Season RESTART (E1/R1): retire the user's live rows so `hasSave` is false and the new season's
   * history starts clean. ROTATE rather than destroy (non-degradation: the retired season's record
   * stays in the table for inspection); the next `saveFor` begins a fresh `version` count for the live
   * rows (MAX over live rows is now 0).
   */
  resetUser(user: string): void {
    this.stmtRetire.run(user);
  }

  /** The users with at least one LIVE durable save (boot preload) — keyed by user id, never a path. */
  listUsers(): string[] {
    return (this.stmtListUsers.all() as Array<{ user: string }>).map((r) => r.user);
  }

  /** Close the underlying database handle (test/ops hygiene). */
  close(): void {
    this.db.close();
  }

  /**
   * Bounded retention (mirrors FileSaveStore's E4): a snapshot is a FULL superset of everything before
   * it (non-degradation lives in the snapshot's content, not in keeping every historical row), so we
   * keep the newest `RETAIN_RECENT` live versions plus the newest `RETAIN_CHECKPOINTS` periodic
   * checkpoints and DELETE the rest. Retired rows are left untouched (they are off the live path and
   * preserve the dead season's record).
   */
  private prune(user: string, latest: number): void {
    const keep = new Set<number>();
    for (let v = latest; v > latest - SqliteSaveStore.RETAIN_RECENT && v > 0; v--) keep.add(v);
    // PERSIST-11 (mirrors the same fix in FileSaveStore.prune): don't spend a `RETAIN_CHECKPOINTS`
    // slot on a candidate that's already covered by the recent-retention window above.
    let checkpoints = 0;
    for (let v = latest - (latest % SqliteSaveStore.CHECKPOINT_EVERY);
      v > 0 && checkpoints < SqliteSaveStore.RETAIN_CHECKPOINTS;
      v -= SqliteSaveStore.CHECKPOINT_EVERY) {
      if (keep.has(v)) continue;
      keep.add(v);
      checkpoints++;
    }
    const live = this.db
      .prepare("SELECT version FROM saves WHERE user = ? AND retired = 0")
      .all(user) as Array<{ version: number }>;
    const del = this.db.prepare("DELETE FROM saves WHERE user = ? AND version = ?");
    for (const { version } of live) {
      if (!keep.has(version)) del.run(user, version);
    }
  }
}
