import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

  private latestVersion(dir: string): number {
    if (!existsSync(dir)) return 0;
    let max = 0;
    for (const file of readdirSync(dir)) {
      const m = /^v(\d+)\.json$/.exec(file);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  saveFor(user: string, snapshot: SessionSnapshot): void {
    const dir = this.userDir(user);
    mkdirSync(dir, { recursive: true });
    const version = this.latestVersion(dir) + 1;
    const file = join(dir, `v${String(version).padStart(6, "0")}.json`);
    writeFileSync(file, JSON.stringify(snapshot), "utf8");
  }

  hasSave(user: string): boolean {
    return this.latestVersion(this.userDir(user)) > 0;
  }

  loadLatest(user: string): SessionSnapshot | null {
    const dir = this.userDir(user);
    const version = this.latestVersion(dir);
    if (version === 0) return null;
    const file = join(dir, `v${String(version).padStart(6, "0")}.json`);
    return JSON.parse(readFileSync(file, "utf8")) as SessionSnapshot;
  }
}
