import {
  mkdirSync, readFileSync, renameSync, existsSync,
  openSync, writeSync, fsyncSync, closeSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { UserNotorietyStore } from "../../ports/UserNotorietyStore";
import type { NotorietySummary } from "../../engine/notoriety";
import { accumulateNotoriety } from "../../engine/notoriety";

/**
 * Disk-backed per-USER `UserNotorietyStore` (feature 0104). One small JSON per user under
 * `<dataDir>/notoriety/<hex-user>.json` — a bounded `NotorietySummary`, NOT the per-season save.
 *
 * CRITICAL — it lives in a SEPARATE subtree from the per-season `FileSaveStore` user dirs, so the
 * season RESTART rotation (`UserSaveStore.resetUser`, which renames `<dataDir>/<hex-user>` off the live
 * path) NEVER touches it: account-level reputation must survive the season cutover by construction (R4).
 *
 * Per-user files are keyed by a HEX encoding of the user id (no user-controlled string ever becomes a
 * path segment ⇒ no traversal; one user can never read another's file — R3). The write is atomic +
 * durable (temp → fsync → rename → dir fsync), like `FileSaveStore`.
 */
export class FileUserNotorietyStore implements UserNotorietyStore {
  private readonly baseDir: string;

  constructor(dataDir?: string) {
    const root = dataDir ?? process.env.ORWELL_DATA_DIR ?? process.env.BBAI_DATA_DIR ?? "./.orwell-data";
    this.baseDir = join(root, "notoriety");
  }

  /** Defense-in-depth path containment (the FileSaveStore #1072 pattern) — assert, never rewrite. */
  private resolveWithin(joined: string): string {
    const base = resolve(this.baseDir);
    const real = resolve(joined);
    if (real !== base && !real.startsWith(base + sep)) {
      throw new Error("FileUserNotorietyStore: refusing a path that escapes the notoriety dir");
    }
    return joined;
  }

  private fileFor(user: string): string {
    return this.resolveWithin(join(this.baseDir, `${Buffer.from(user, "utf8").toString("hex")}.json`));
  }

  read(user: string): NotorietySummary | null {
    const file = this.fileFor(user);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as NotorietySummary;
    } catch {
      return null; // a corrupt notoriety file is non-fatal — the user simply reads as un-known this season
    }
  }

  accumulate(user: string, summary: NotorietySummary): void {
    const merged = accumulateNotoriety(this.read(user), summary);
    mkdirSync(this.baseDir, { recursive: true });
    const file = this.fileFor(user);
    const tmp = `${file}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(merged), null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
    try {
      const dirFd = openSync(this.baseDir, "r");
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch { /* best-effort: some platforms refuse directory fsync — the data fsync above held */ }
  }
}

/**
 * In-memory `UserNotorietyStore` (the test adapter + the default runtime when no durable store is
 * composed). Per-user keyed; never a cross-user read (R3). Monotonic accumulate (non-degradation).
 */
export class InMemoryUserNotorietyStore implements UserNotorietyStore {
  private readonly byUser = new Map<string, NotorietySummary>();

  read(user: string): NotorietySummary | null {
    return this.byUser.get(user) ?? null;
  }

  accumulate(user: string, summary: NotorietySummary): void {
    this.byUser.set(user, accumulateNotoriety(this.byUser.get(user) ?? null, summary));
  }
}
