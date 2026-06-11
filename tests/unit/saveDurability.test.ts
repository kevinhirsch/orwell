import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Lane 8 / audit E8 — save-write durability. The atomic temp+rename (B35/E2) protects against a
 * CRASH; it does not protect against POWER LOSS, where an unflushed page cache can leave the
 * renamed "latest" truncated (⇒ quarantined `.corrupt` ⇒ a silent multi-turn step-back on boot —
 * exactly the degradation 0007/0030 forbid). The fix is fsync(file) BEFORE the rename and
 * fsync(directory) AFTER it. The ordering is the contract — pinned here by instrumenting the
 * real fs calls the store makes (the writes still hit the real filesystem).
 *
 * Roles only — no names.
 */

const calls: string[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    openSync: (...args: Parameters<typeof real.openSync>) => {
      calls.push(`open:${String(args[0])}`);
      return real.openSync(...args);
    },
    fsyncSync: (fd: number) => {
      calls.push("fsync");
      return real.fsyncSync(fd);
    },
    renameSync: (...args: Parameters<typeof real.renameSync>) => {
      calls.push(`rename:${String(args[1])}`);
      return real.renameSync(...args);
    },
  };
});

// Import AFTER the mock so the store binds the instrumented functions.
const { FileSaveStore } = await import("../../src/adapters/engine/FileSaveStore");
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";

const snap = (phase: string): SessionSnapshot =>
  ({ started: true, week: 1, phase, ceremony: { nominees: [], vetoUsed: false }, house: null, events: [], relationships: [] }) as SessionSnapshot;

describe("E8 — saves are fsynced, in the durable order", () => {
  it("fsyncs the temp file BEFORE the rename and the directory AFTER it", () => {
    const dir = mkdtempSync(join(tmpdir(), "orwell-e8-"));
    const store = new FileSaveStore(dir);
    calls.length = 0;

    store.saveFor("u", snap("a"));

    const firstFsync = calls.indexOf("fsync");
    const rename = calls.findIndex((c) => c.startsWith("rename:") && c.endsWith("v000001.json"));
    const lastFsync = calls.lastIndexOf("fsync");
    expect(firstFsync, "the temp file's content must be fsynced").toBeGreaterThanOrEqual(0);
    expect(rename, "the atomic rename must still happen").toBeGreaterThan(firstFsync);
    expect(lastFsync, "the DIRECTORY must be fsynced after the rename (so the rename survives power loss)").toBeGreaterThan(rename);
  });

  it("the durable write still round-trips and leaves no temp file (B35 intact)", () => {
    const dir = mkdtempSync(join(tmpdir(), "orwell-e8-"));
    const store = new FileSaveStore(dir);
    store.saveFor("u", snap("a"));
    store.saveFor("u", snap("b"));
    expect(store.loadLatest("u")!.phase).toBe("b");
    const userDir = join(dir, Buffer.from("u", "utf8").toString("hex"));
    expect(readdirSync(userDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
