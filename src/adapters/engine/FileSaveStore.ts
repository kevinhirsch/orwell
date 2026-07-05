import {
  mkdirSync, readdirSync, readFileSync, renameSync, existsSync, unlinkSync,
  openSync, writeSync, fsyncSync, closeSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { UserSaveStore } from "../../ports/UserSaveStore";
import type { SessionSnapshot } from "../../engine/sessionSnapshot";

/**
 * Disk-backed, per-user durable `UserSaveStore` (feature 0030). Each save is a NEW
 * versioned file under `<dataDir>/<user>/vNNNNNN.json` (never overwritten in place);
 * `loadLatest` reads the highest version. Survives a process restart: a fresh
 * registry over the same dir recalls the game.
 *
 * Retention is BOUNDED (B58/audit E4): a snapshot is a FULL superset of everything
 * before it (0007's non-degradation lives in the snapshot's content, not in keeping
 * every historical file), and an unbounded file-per-mutation history is O(n²) disk.
 * We keep the newest `RETAIN_RECENT` versions plus the newest `RETAIN_CHECKPOINTS`
 * periodic checkpoints (every `CHECKPOINT_EVERY`th version) and prune the rest.
 *
 * Per-user directories are keyed by a hex encoding of the user id, so one user can
 * never read another's saves and no user-controlled string ever becomes a path
 * segment (no traversal). ENGINE-ONLY (persists souls + the hidden relationship
 * layer).
 */
export class FileSaveStore implements UserSaveStore {
  /** Newest versions always retained (the working window incl. crash-recovery slack). */
  private static readonly RETAIN_RECENT = 5;
  /** Every Nth version is a periodic checkpoint... */
  private static readonly CHECKPOINT_EVERY = 50;
  /** ...of which only the newest few are retained (the long-tail archive stays bounded). */
  private static readonly RETAIN_CHECKPOINTS = 3;

  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir =
      dataDir ?? process.env.ORWELL_DATA_DIR ?? process.env.BBAI_DATA_DIR ?? "./.orwell-data";
  }

  /**
   * Defense-in-depth path containment (issue #1072). Every disk path this store touches is built
   * from a `join()` whose first user-derived segment is a HEX encoding of the user id (`userDir`) and
   * whose leaf is a numeric `vNNNNNN.json` (`fileFor`) — so a user-controlled string can never reach
   * the path verbatim and `..`/`/`/`\` can never appear in a segment. This helper makes that
   * guarantee *structural* rather than incidental: it resolves the candidate against the resolved
   * `dataDir` and throws if the result escapes the base, so even a future caller that fed an attacker
   * string in could not traverse out. It returns the original `join()`-built path UNCHANGED for any
   * legitimate input (the resolve is a containment ASSERTION only, never a path rewrite), so existing
   * saves keep their exact on-disk paths — non-degradation (feature 0007/0030) stays byte-identical.
   */
  private resolveWithin(joined: string): string {
    const base = resolve(this.dataDir);
    const real = resolve(joined);
    if (real !== base && !real.startsWith(base + sep)) {
      throw new Error("FileSaveStore: refusing a path that escapes the data dir");
    }
    return joined;
  }

  private userDir(user: string): string {
    return this.resolveWithin(join(this.dataDir, Buffer.from(user, "utf8").toString("hex")));
  }

  private fileFor(dir: string, version: number): string {
    return this.resolveWithin(join(dir, `v${String(version).padStart(6, "0")}.json`));
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
    // Atomic + DURABLE write (audit E2 + E8): a crash mid-write must never leave a truncated file
    // as the "latest" version — write a temp, fsync the temp's CONTENT, rename (atomic on the same
    // filesystem), then fsync the DIRECTORY so the rename itself survives power loss. Without the
    // fsyncs, a power cut could quarantine the newest save (`.corrupt`) and silently step the game
    // back several turns on the next boot (non-degradation, feature 0007/0030).
    const tmp = `${file}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(snapshot), null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
    try {
      const dirFd = openSync(dir, "r");
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch { /* best-effort: some platforms refuse directory fsync — the data fsync above held */ }
    this.prune(dir, this.latestVersion(dir));
  }

  /** Bounded retention (B58/audit E4): keep the recent window + the newest periodic checkpoints. */
  private prune(dir: string, latest: number): void {
    const keep = new Set<number>();
    for (let v = latest; v > latest - FileSaveStore.RETAIN_RECENT && v > 0; v--) keep.add(v);
    // PERSIST-11: whenever `latest % CHECKPOINT_EVERY` is small, the FIRST checkpoint candidate
    // (`latest - (latest % CHECKPOINT_EVERY)`) can land INSIDE the recent-retention window already
    // added above — a redundant hit that used to still consume one of the `RETAIN_CHECKPOINTS`
    // slots, leaving the long-tail archive with fewer genuinely-older checkpoints than intended for
    // roughly one save in ten. Skip an already-kept candidate without spending a slot.
    let checkpoints = 0;
    for (let v = latest - (latest % FileSaveStore.CHECKPOINT_EVERY);
      v > 0 && checkpoints < FileSaveStore.RETAIN_CHECKPOINTS;
      v -= FileSaveStore.CHECKPOINT_EVERY) {
      if (keep.has(v)) continue;
      keep.add(v);
      checkpoints++;
    }
    for (const v of this.versionsDescending(dir)) {
      if (!keep.has(v)) {
        try { unlinkSync(this.fileFor(dir, v)); } catch { /* best-effort: already pruned */ }
      }
    }
  }

  hasSave(user: string): boolean {
    return this.latestVersion(this.userDir(user)) > 0;
  }

  /**
   * Season restart (audit E1/R1): ROTATE the user's save dir off the live path — `hasSave` goes
   * false, the new season's `v000001` starts clean, and an engine restart resumes season 2 instead
   * of resurrecting the dead one. The retired dir keeps the old season's record on disk (suffixed,
   * so `listUsers`' hex filter never resumes it); the factory-reset script scrubs the whole tree.
   */
  resetUser(user: string): void {
    const dir = this.userDir(user);
    if (!existsSync(dir)) return;
    let target = `${dir}.retired-${Date.now()}`;
    for (let i = 1; existsSync(target); i++) target = `${dir}.retired-${Date.now()}-${i}`;
    renameSync(dir, target);
  }

  /**
   * PERS-NEW-2 (#592): quarantine the newest save off the live `vNNNNNN.json` path (`.incompatible`)
   * when a resume REJECTED it for an incompatible/future `snapshotVersion`. A future-version save
   * parses fine, so `loadLatest` never `.corrupt`-quarantines it; without this belt the fresh
   * sandbox's later saves would prune the user's own higher-schema save out of retention. Renaming it
   * off the version-matching pattern protects it permanently (and keeps it recoverable on a downgrade).
   */
  quarantineIncompatible(user: string): void {
    const dir = this.userDir(user);
    const latest = this.latestVersion(dir);
    if (latest <= 0) return;
    const file = this.fileFor(dir, latest);
    let target = `${file}.incompatible`;
    for (let i = 1; existsSync(target); i++) target = `${file}.incompatible-${i}`;
    try { renameSync(file, target); } catch { /* best-effort quarantine */ }
  }

  /** The users with at least one durable save (B60/E11) — dir names are hex-encoded user ids. */
  listUsers(): string[] {
    if (!existsSync(this.dataDir)) return [];
    const users: string[] = [];
    for (const entry of readdirSync(this.dataDir)) {
      if (!/^([0-9a-f]{2})+$/i.test(entry)) continue; // not a user dir (e.g. stray files)
      const user = Buffer.from(entry, "hex").toString("utf8");
      if (this.hasSave(user)) users.push(user);
    }
    return users;
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
