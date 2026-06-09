import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { UserSaveStore } from "../../ports/UserSaveStore";
import type { SessionSnapshot } from "../../engine/sessionSnapshot";

/**
 * Disk-backed, per-user durable `UserSaveStore` (feature 0030). Each save is a NEW
 * versioned file under `<dataDir>/<user>/vNNNNNN.json`; prior versions are never
 * overwritten (non-degradation, 0007) and `loadLatest` reads the highest version.
 * Survives a process restart: a fresh registry over the same dir recalls the game.
 *
 * Per-user directories are keyed by a hex encoding of the user id, so one user can
 * never read another's saves and no user-controlled string ever becomes a path
 * segment (no traversal). ENGINE-ONLY (persists souls + the hidden relationship
 * layer).
 */
export class FileSaveStore implements UserSaveStore {
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir =
      dataDir ?? process.env.ORWELL_DATA_DIR ?? process.env.BBAI_DATA_DIR ?? "./.orwell-data";
  }

  private userDir(user: string): string {
    return join(this.dataDir, Buffer.from(user, "utf8").toString("hex"));
  }

  private fileFor(dir: string, version: number): string {
    return join(dir, `v${String(version).padStart(6, "0")}.json`);
  }

  /** Save versions present in `dir`, descending. Quarantined (`.corrupt`) files no longer match. */
  private versionsDescending(dir: string): number[] {
    if (!existsSync(dir)) return [];
    const versions: number[] = [];
    for (const file of readdirSync(dir)) {
      const m = /^v(\d+)\.json$/.exec(file);
      if (m) versions.push(Number(m[1]));
    }
    return versions.sort((a, b) => b - a);
  }

  private latestVersion(dir: string): number {
    return this.versionsDescending(dir)[0] ?? 0;
  }

  saveFor(user: string, snapshot: SessionSnapshot): void {
    const dir = this.userDir(user);
    mkdirSync(dir, { recursive: true });
    const file = this.fileFor(dir, this.latestVersion(dir) + 1);
    // Atomic write (audit E2): a crash mid-write must never leave a truncated file as the "latest"
    // version — write a temp then rename (atomic on the same filesystem), so a reader sees all-or-nothing.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot), "utf8");
    renameSync(tmp, file);
  }

  hasSave(user: string): boolean {
    return this.latestVersion(this.userDir(user)) > 0;
  }

  /**
   * The newest READABLE save. A corrupt highest version (e.g. truncated by a crash) is **quarantined**
   * (renamed `.corrupt`, so it can never be "latest" again → no restart crash-loop) and we **step
   * down** to the next-lower version. Returns null only when no version parses (⇒ a fresh sandbox).
   */
  loadLatest(user: string): SessionSnapshot | null {
    const dir = this.userDir(user);
    for (const version of this.versionsDescending(dir)) {
      const file = this.fileFor(dir, version);
      try {
        return JSON.parse(readFileSync(file, "utf8")) as SessionSnapshot;
      } catch {
        try { renameSync(file, `${file}.corrupt`); } catch { /* best-effort quarantine */ }
      }
    }
    return null;
  }
}
