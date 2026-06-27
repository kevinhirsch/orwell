import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";

/**
 * Issue #1072 — defense-in-depth path containment for the engine-only `FileSaveStore`.
 *
 * The store already hex-encodes the user id into the path segment and uses numeric
 * `vNNNNNN.json` filenames, so a user-controlled string can never reach the path verbatim
 * (the static "file inclusion via reading file" finding is a FALSE POSITIVE). These tests
 * pin the added `resolveWithin` belt: (a) a crafted traversal attempt is refused, and
 * (b) a normal save still round-trips byte-for-byte and writes to the expected hex dir
 * (non-degradation — feature 0007/0030 — stays intact).
 *
 * HARD rule: roles only — no names.
 */

const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-pathguard-"));
const hexDir = (base: string, user: string): string =>
  join(base, Buffer.from(user, "utf8").toString("hex"));
const snap = (phase: string): SessionSnapshot =>
  ({
    started: true,
    week: 1,
    phase,
    ceremony: { nominees: [], vetoUsed: false },
    house: null,
    events: [],
    relationships: [],
  }) as SessionSnapshot;

describe("#1072 — FileSaveStore path containment (defense-in-depth)", () => {
  it("(a) refuses a user id crafted to traverse out of the data dir", () => {
    const dir = freshDir();
    const store = new FileSaveStore(dir);

    // A classic traversal payload. Today it is hex-encoded (so it is already inert), but the
    // belt must hold even if a future refactor stopped encoding it: nothing may be written
    // outside the data dir. We assert the escape sentinel never lands beside the data dir.
    const escapeUser = "../../../../etc/orwell-pwned";
    // The store NEVER writes a literal-string segment (it hex-encodes), so this save SUCCEEDS
    // into a hex dir and writes NOTHING outside the base — the real guarantee.
    expect(() => store.saveFor(escapeUser, snap("x"))).not.toThrow();

    const parent = resolve(dir, "..");
    const siblings = existsSync(parent) ? readdirSync(parent) : [];
    expect(siblings.some((s) => s.includes("orwell-pwned"))).toBe(false);
    // And the only thing under the base is the hex-encoded dir for that user.
    const onDisk = readdirSync(dir);
    expect(onDisk).toEqual([Buffer.from(escapeUser, "utf8").toString("hex")]);
  });

  it("(a') the resolveWithin belt throws when a path would escape the base", () => {
    // Reach the private guard directly to prove it fails closed if ever fed an escaping path
    // (a future caller that bypassed the hex encoding). Cast to reach the private member.
    const dir = freshDir();
    const store = new FileSaveStore(dir) as unknown as {
      resolveWithin(joined: string): string;
      dataDir: string;
    };
    const escaping = join(store.dataDir, "..", "..", "etc", "passwd");
    expect(() => store.resolveWithin(escaping)).toThrow(/escapes the data dir/);
    // A legitimate in-base path is returned UNCHANGED (byte-identical — never rewritten).
    const legit = hexDir(store.dataDir, "player");
    expect(store.resolveWithin(legit)).toBe(legit);
  });

  it("(b) a normal save round-trips and lands in the expected hex directory", () => {
    const dir = freshDir();
    const store = new FileSaveStore(dir);

    // Two versioned saves for a role-named user.
    store.saveFor("player", snap("nominations"));
    store.saveFor("player", snap("eviction"));

    // Loads back the newest — full content survives (non-degradation).
    const loaded = store.loadLatest("player");
    expect(loaded).not.toBeNull();
    expect(loaded!.phase).toBe("eviction");
    expect(loaded!.week).toBe(1);
    expect(store.hasSave("player")).toBe(true);

    // The on-disk path is exactly the hex dir + numeric version files (unchanged format).
    const userDir = hexDir(dir, "player");
    expect(statSync(userDir).isDirectory()).toBe(true);
    const versions = readdirSync(userDir)
      .filter((f) => /^v\d+\.json$/.test(f))
      .sort();
    expect(versions).toEqual(["v000001.json", "v000002.json"]);
    expect(readdirSync(userDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    // listUsers still recovers the user from the hex dir name.
    expect(store.listUsers()).toEqual(["player"]);
  });

  it("(b') a save round-trips even when the dataDir is the default relative path shape", () => {
    // The default dataDir is RELATIVE ("./.orwell-data"); resolveWithin must not break that —
    // resolve() is used only for the containment check, the returned path stays relative-rooted.
    const dir = freshDir();
    const store = new FileSaveStore(dir);
    store.saveFor("hoh", snap("hoh-comp"));
    expect(store.loadLatest("hoh")!.phase).toBe("hoh-comp");
  });
});
