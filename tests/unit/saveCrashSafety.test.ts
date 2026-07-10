import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { GameSessionRegistry } from "../../src/composition/registry";
import { composeRuntime } from "../../src/composition/runtime";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";

/**
 * Feature B35 / audit E2 — one corrupt save must not crash-loop the engine for everyone.
 * Atomic writes, tolerant (quarantine-and-step-down) loads, and guarded request/tick handlers.
 * HARD rule: roles only — no names.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-b35-"));
const userDir = (dir: string, user: string): string => join(dir, Buffer.from(user, "utf8").toString("hex"));
const snap = (phase: string): SessionSnapshot =>
  ({ started: true, week: 1, phase, ceremony: { nominees: [], vetoUsed: false }, house: null, events: [], relationships: [] }) as SessionSnapshot;
const versionFiles = (dir: string, user: string): string[] =>
  readdirSync(userDir(dir, user)).filter((f) => /^v\d+\.json$/.test(f)).sort();

describe("B35 — crash-safe saves (FileSaveStore)", () => {
  it("writes atomically — no stray temp file is left behind", () => {
    const dir = freshDir();
    const store = new FileSaveStore(dir);
    store.saveFor("u", snap("a"));
    store.saveFor("u", snap("b"));
    const files = readdirSync(userDir(dir, "u"));
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]); // the temp was renamed away
    expect(versionFiles(dir, "u")).toEqual(["v000001.json", "v000002.json"]);
    expect(store.loadLatest("u")!.phase).toBe("b");
  });

  it("quarantines a corrupt latest version and steps down to the last good one", () => {
    const dir = freshDir();
    const store = new FileSaveStore(dir);
    store.saveFor("u", snap("good"));    // v1
    store.saveFor("u", snap("newer"));   // v2
    // A crash truncates the highest version mid-write.
    const latest = join(userDir(dir, "u"), "v000002.json");
    writeFileSync(latest, '{ "started": true, "wee', "utf8");

    expect(store.loadLatest("u")!.phase).toBe("good"); // stepped down to v1
    expect(existsSync(latest)).toBe(false);            // the bad file can never be "latest" again
    expect(existsSync(`${latest}.corrupt`)).toBe(true); // it was quarantined, not deleted
  });

  it("returns null (⇒ a fresh sandbox) only when no version parses", () => {
    const dir = freshDir();
    const store = new FileSaveStore(dir);
    store.saveFor("u", snap("a"));
    writeFileSync(join(userDir(dir, "u"), "v000001.json"), "not json at all", "utf8");
    expect(store.loadLatest("u")).toBeNull();
  });

  it("a registry resumes from the last good save after a crash-corrupted latest", () => {
    const dir = freshDir();
    const r1 = new GameSessionRegistry(new FileSaveStore(dir));
    const sb = r1.sandboxFor("u");
    sb.session.createCharacter({ playerName: "P", seed: 2 }); // save v1 (and more, on each mutation)
    r1.saveUser("u");                                          // a couple of explicit good versions
    r1.saveUser("u");
    const files = versionFiles(dir, "u");
    expect(files.length).toBeGreaterThanOrEqual(2);

    // Corrupt the highest version (a crash mid-write).
    const latest = join(userDir(dir, "u"), files[files.length - 1]!);
    writeFileSync(latest, "{ truncated", "utf8");

    // A fresh registry (process restart) resumes the user's game instead of crash-looping.
    const r2 = new GameSessionRegistry(new FileSaveStore(dir));
    expect(r2.sandboxFor("u").session.snapshot().started).toBe(true);
    expect(existsSync(`${latest}.corrupt`)).toBe(true);
  });
});

describe("B35 — the boot resume is guarded (one corrupt save can't crash the engine for everyone)", () => {
  it("an unresumable saved user is tolerated; the healthy user still boots (no crash-loop)", () => {
    const dir = freshDir();
    // Boot 1: two users start + persist games (real-time purge 2026-07-10 — no watcher; the runtime
    // is purely turn-driven, and the boot RESUME is the surface B35 must keep crash-safe).
    const r1 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() });
    r1.registry.sandboxFor("ok").session.createCharacter({ playerName: "P", seed: 4 });
    r1.registry.sandboxFor("boom").session.createCharacter({ playerName: "Q", seed: 5 });

    // A crash corrupts every version of one user's save so it can never parse.
    for (const f of versionFiles(dir, "boom")) {
      writeFileSync(join(userDir(dir, "boom"), f), "{ truncated", "utf8");
    }

    // Boot 2 (a deploy): the corrupt save is tolerated (quarantine-and-step-down), the whole boot
    // does not throw, and the healthy user still resumes a STARTED game.
    let r2!: ReturnType<typeof composeRuntime>;
    expect(() => { r2 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() }); }).not.toThrow();
    expect(r2.registry.sandboxFor("ok").session.snapshot().started).toBe(true);
  });
});
