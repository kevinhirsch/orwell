import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { GameSessionRegistry } from "../../src/composition/registry";
import { toGameState } from "../../src/engine/sessionSnapshot";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";
import { counts, isSuperset } from "../../src/domain/saveState";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature B40 / audit C2+C3+C4 — the snapshot is the contract. The knowledge layer + the id/ts
 * counters now round-trip, the checkpoint can SEE knowledge, and an unknown-version save is rejected
 * (not crashed on). HARD rule: roles only — no names.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-b40-"));

function startedGame(dir: string, user = "u", seed = 2): GameSessionRegistry {
  const reg = new GameSessionRegistry(new FileSaveStore(dir));
  reg.sandboxFor(user).session.createCharacter({ playerName: "P", seed });
  return reg;
}

describe("B40 — the knowledge layer survives a restart", () => {
  it("a surfaced fact and a Diary-Room entry both return after a restart", () => {
    const dir = freshDir();
    const reg = startedGame(dir);
    const sb = reg.sandboxFor("u");

    sb.engine.knowledge.seedBelief(npc(1), { content: "the secret", factId: "s" }, "witnessed"); // anchor (B39)
    expect(sb.commands.surfaceInformationTo({ entity: PLAYER, fact: { content: "the secret" }, pathway: "told-by:npc:1" }).surfaced).toBe(true);
    sb.commands.diaryRoom({ entry: "my private plan" });
    reg.saveUser("u");

    // A fresh registry (process restart) over the same dir recalls the knowledge layer.
    const known = new GameSessionRegistry(new FileSaveStore(dir)).sandboxFor("u").engine.knowledge.knownTo(PLAYER);
    expect(known.some((k) => k.content === "the secret")).toBe(true);
    expect(known.some((k) => k.content === "my private plan")).toBe(true);
  });

  it("pre- and post-restart interactions get distinct ids and monotonic ts", () => {
    const dir = freshDir();
    const reg = startedGame(dir);
    const before = reg.sandboxFor("u").commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat A" });
    reg.saveUser("u");

    const reg2 = new GameSessionRegistry(new FileSaveStore(dir));
    const sb2 = reg2.sandboxFor("u");
    const after = sb2.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat B" });

    expect(after.eventId).not.toBe(before.eventId); // no duplicate id across the restart
    const evs = sb2.engine.events.query();
    const tsOf = (id: string): number => evs.find((e) => e.id === id)!.ts;
    expect(tsOf(after.eventId)).toBeGreaterThan(tsOf(before.eventId)); // ts is monotonic
  });
});

describe("B40 — the checkpoint can see the knowledge layer", () => {
  it("a snapshot whose knowledge shrank is flagged as a degradation (not a superset)", () => {
    const dir = freshDir();
    const reg = startedGame(dir);
    const sb = reg.sandboxFor("u");
    sb.engine.knowledge.seedBelief(npc(1), { content: "a fact", factId: "f" }, "witnessed");
    sb.commands.surfaceInformationTo({ entity: PLAYER, fact: { content: "a fact" }, pathway: "told-by:npc:1" });

    const full = reg.snapshot("u");
    expect(counts(toGameState(full)).knowledge).toBeGreaterThan(0); // the checkpoint now COUNTS knowledge

    // A candidate that dropped a known fact is NOT a superset of the full save ⇒ degradation caught.
    const shrunk: SessionSnapshot = { ...full, knowledge: { knowledge: {}, suspicions: {}, seq: full.knowledge!.seq, tick: full.knowledge!.tick } };
    expect(isSuperset(toGameState(full), toGameState(shrunk))).toBe(true);   // full ⊇ shrunk
    expect(isSuperset(toGameState(shrunk), toGameState(full))).toBe(false);  // shrunk drops a fact ⇒ flagged
  });
});

describe("B40 — an unknown snapshot version is rejected, not crashed on", () => {
  it("resuming a future-version save starts a fresh sandbox instead of crashing", () => {
    const dir = freshDir();
    const reg = startedGame(dir);
    reg.saveUser("u");
    const store = new FileSaveStore(dir);
    const bad = { ...store.loadLatest("u")!, snapshotVersion: 999 } as SessionSnapshot; // an unknown future schema
    store.saveFor("u", bad);

    // The resume rejects the bad save into a fresh sandbox — no throw out of sandboxFor.
    const reg2 = new GameSessionRegistry(new FileSaveStore(dir));
    let sb!: ReturnType<GameSessionRegistry["sandboxFor"]>;
    expect(() => { sb = reg2.sandboxFor("u"); }).not.toThrow();
    expect(sb.session.snapshot().started).toBe(false);

    // restore() surfaces the incompatibility loudly (the rollback path expects a current-version save).
    expect(() => reg2.restore("u", bad)).toThrow(/snapshot version/);
  });

  it("PERS-NEW-2 (#592): a rejected future-version save is QUARANTINED so fresh saves can't prune it out", () => {
    const dir = freshDir();
    const reg = startedGame(dir);
    reg.saveUser("u");
    const store = new FileSaveStore(dir);
    const bad = { ...store.loadLatest("u")!, snapshotVersion: 999 } as SessionSnapshot; // higher schema
    store.saveFor("u", bad);

    // A fresh registry rejects the future save → fresh sandbox (no resume), and quarantines it.
    const reg2 = new GameSessionRegistry(new FileSaveStore(dir));
    reg2.sandboxFor("u"); // triggers the rejected resume + quarantine belt

    // Drive enough fresh-game saves to blow past the retention window (RETAIN_RECENT=5).
    const sb = reg2.sandboxFor("u");
    sb.session.createCharacter({ playerName: "P", seed: 3 });
    for (let i = 0; i < 8; i++) reg2.saveUser("u");

    // The original higher-schema save survived as a `.incompatible` file — retention never touched it.
    const userDir = join(dir, Buffer.from("u", "utf8").toString("hex"));
    const files = readdirSync(userDir);
    expect(files.some((f) => f.endsWith(".incompatible")), `quarantine file present in ${files.join(",")}`).toBe(true);
    // And the quarantined snapshot is still the higher-schema one (recoverable on a downgrade).
    const quarantined = files.find((f) => f.endsWith(".incompatible"))!;
    const recovered = JSON.parse(readFileSync(join(userDir, quarantined), "utf8")) as SessionSnapshot;
    expect(recovered.snapshotVersion).toBe(999);
  });

  it("a versionless legacy save still migrates forward (resumes)", () => {
    const dir = freshDir();
    const reg = startedGame(dir);
    reg.saveUser("u");
    const store = new FileSaveStore(dir);
    const legacy = { ...store.loadLatest("u")! };
    delete (legacy as { snapshotVersion?: number }).snapshotVersion; // a pre-B40 save
    delete (legacy as { knowledge?: unknown }).knowledge;
    store.saveFor("u", legacy as SessionSnapshot);

    const resumed = new GameSessionRegistry(new FileSaveStore(dir)).sandboxFor("u").session.snapshot();
    expect(resumed.started).toBe(true); // legacy migrates, the game resumes
  });
});

describe("R3 — toGameState is memoized by snapshot identity (safe, pure)", () => {
  it("returns the SAME object on an unchanged poll (R3 cache hit), a fresh one after a mutation, and stays correct", () => {
    const dir = freshDir();
    const reg = startedGame(dir);
    const sb = reg.sandboxFor("u");
    sb.engine.knowledge.seedBelief(npc(1), { content: "a fact", factId: "f" }, "witnessed");

    const snap = reg.snapshot("u");
    const a = toGameState(snap);
    expect(toGameState(snap)).toBe(a); // identity memo hit — the redundant re-projection is skipped

    // R3 incremental cache: re-exporting an UNCHANGED game returns the SAME frozen snapshot by
    // reference, so a between-turn poll recomputes nothing and the projection memo still hits.
    const snap2 = reg.snapshot("u");
    expect(snap2).toBe(snap);
    expect(toGameState(snap2)).toBe(a);

    // A real mutation (a direct event append → the O(1) event-count cache key) invalidates it:
    // a FRESH snapshot object, projected fresh.
    sb.engine.events.record({ id: "direct:mut", ts: 1, type: "house-event", initiator: npc(1), witnessSet: [npc(1)], hidden: true, content: "a mutation" });
    const snap3 = reg.snapshot("u");
    expect(snap3).not.toBe(snap);
    expect(toGameState(snap3)).not.toBe(a);
  });
});
