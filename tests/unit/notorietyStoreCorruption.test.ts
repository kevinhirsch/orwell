import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileUserNotorietyStore } from "../../src/adapters/engine/FileUserNotorietyStore";

/**
 * PERSIST-10 — a corrupt on-disk notoriety file used to be silently discarded with no quarantine,
 * no backup, and no log: `read()` swallowed the parse error and returned `null`, and the very next
 * `accumulate()` call would overwrite the bad file with just the current season's summary,
 * permanently losing the user's whole cross-season reputation history. `FileSaveStore` already
 * treats this class of corruption seriously (quarantine + step-down); this store had none of that
 * discipline. These tests pin the fix: the bad bytes are preserved (renamed `.corrupt-<ts>`) before
 * `read()` ever returns `null`, and a loud console.error is emitted.
 *
 * HARD rule: roles only — no names.
 */

const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-notoriety-corrupt-"));
const hexFile = (base: string, user: string): string =>
  join(base, "notoriety", `${Buffer.from(user, "utf8").toString("hex")}.json`);

describe("PERSIST-10 — FileUserNotorietyStore quarantines a corrupt file instead of silently losing it", () => {
  it("a corrupt file is renamed .corrupt-<ts> and read() returns null (loudly, not silently)", () => {
    const dir = freshDir();
    const store = new FileUserNotorietyStore(dir);
    const file = hexFile(dir, "user-a");
    // Write a torn/corrupt file directly (simulating a partial write / disk fault).
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(dir, "notoriety"), { recursive: true });
    writeFileSync(file, "{not valid json");

    const errSpy = { called: false, msg: "" };
    const origError = console.error;
    console.error = (msg?: unknown) => { errSpy.called = true; errSpy.msg = String(msg); };
    try {
      expect(store.read("user-a")).toBeNull();
    } finally {
      console.error = origError;
    }
    expect(errSpy.called).toBe(true);

    // The original bad bytes are preserved under a `.corrupt-*` sibling — never silently vanished.
    const entries = readdirSync(join(dir, "notoriety"));
    expect(entries.some((f) => f.startsWith(`${Buffer.from("user-a", "utf8").toString("hex")}.json.corrupt-`))).toBe(true);
    // The original (bad) filename no longer exists at the live path.
    expect(existsSync(file)).toBe(false);
  });

  it("accumulate() after a corrupt read starts a fresh summary rather than crashing (documented, non-fatal degrade)", () => {
    const dir = freshDir();
    const store = new FileUserNotorietyStore(dir);
    const file = hexFile(dir, "user-b");
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(dir, "notoriety"), { recursive: true });
    writeFileSync(file, "not json at all");

    const origError = console.error;
    console.error = () => {};
    try {
      expect(() => store.accumulate("user-b", {
        seasonsPlayed: 1, bestPlacement: 1, reputation: {}, legendBeats: [],
      } as never)).not.toThrow();
    } finally {
      console.error = origError;
    }
    // A fresh, readable file now exists at the live path (the quarantined original is untouched).
    expect(existsSync(file)).toBe(true);
    expect(store.read("user-b")).not.toBeNull();
  });
});
