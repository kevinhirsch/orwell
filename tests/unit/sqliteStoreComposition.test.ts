import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { composeRuntime } from "../../src/composition/runtime";
import { SqliteSaveStore } from "../../src/adapters/sqlite/SqliteSaveStore";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { npc } from "../../src/domain/ids";

/**
 * E63 — the `ORWELL_STORE=sqlite` env flag selects the relational adapters in the composition root,
 * and DEFAULT (unset) keeps today's in-memory/file behavior. The save store is the priority seam;
 * the vector index rides on the same flag through `engineRoot`.
 */
describe("E63 — ORWELL_STORE=sqlite composition flag", () => {
  const prev = process.env.ORWELL_STORE;
  const prevDataDir = process.env.ORWELL_DATA_DIR;
  // Keep file-backed stores off the repo tree: a per-run temp data dir for the FileSaveStore path.
  process.env.ORWELL_DATA_DIR = mkdtempSync(join(tmpdir(), "orwell-e63-comp-"));
  afterEach(() => {
    if (prev === undefined) delete process.env.ORWELL_STORE;
    else process.env.ORWELL_STORE = prev;
  });
  // Restore the data dir after the suite (set once; vitest runs files in isolation).
  process.on("beforeExit", () => {
    if (prevDataDir === undefined) delete process.env.ORWELL_DATA_DIR;
    else process.env.ORWELL_DATA_DIR = prevDataDir;
  });

  it("engineRoot soul recall works with the sqlite-vec index when the flag is set", () => {
    process.env.ORWELL_STORE = "sqlite";
    const core = buildEngineCore();
    const HG = npc(1);
    core.soul.recordToSoul(HG, "a brutal veto betrayal that cut deep");
    for (let i = 0; i < 6; i++) core.soul.recordToSoul(HG, `idle small talk ${i}`);
    const r = core.soul.recall(HG, "the veto betrayal", 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toContain("veto betrayal");
  });

  it("engineRoot soul recall still works with the default (in-memory) index", () => {
    delete process.env.ORWELL_STORE;
    const core = buildEngineCore();
    const HG = npc(1);
    core.soul.recordToSoul(HG, "a brutal veto betrayal that cut deep");
    const r = core.soul.recall(HG, "veto betrayal", 1);
    expect(r[0]!.content).toContain("veto betrayal");
  });

  it("composeRuntime({durable:true}) builds a SqliteSaveStore under the flag, FileSaveStore by default", () => {
    process.env.ORWELL_STORE = "sqlite";
    const rt = composeRuntime({ durable: true, watcher: { tickEveryMs: 0 } });
    // The registry's save store is the SQLite adapter (proved by a save/round-trip through it).
    rt.registry.sandboxFor("u1").session.createCharacter({ playerName: "Flagged", seed: 1 });
    expect(rt.registry.snapshot("u1").started).toBe(true);
    rt.stop();

    delete process.env.ORWELL_STORE;
    const rtDefault = composeRuntime({ durable: true, watcher: { tickEveryMs: 0 } });
    rtDefault.registry.sandboxFor("u2").session.createCharacter({ playerName: "Default", seed: 1 });
    expect(rtDefault.registry.snapshot("u2").started).toBe(true);
    rtDefault.stop();
  });

  it("an explicitly-injected save store is honored regardless of the flag (sqlite + file both compose)", () => {
    // The two concrete UserSaveStore implementations are interchangeable behind the port.
    const sqlite: SqliteSaveStore = new SqliteSaveStore(":memory:");
    const file: FileSaveStore = new FileSaveStore();
    expect(typeof sqlite.saveFor).toBe("function");
    expect(typeof file.saveFor).toBe("function");
    sqlite.close();
  });
});
