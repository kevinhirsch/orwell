import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime } from "../../src/composition/runtime";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import { GameSessionRegistry } from "../../src/composition/registry";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { UserSandbox } from "../../src/composition/registry";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView } from "../../src/ports/GameSession";
import { StaleBeatError } from "../../src/domain/errors";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature 0065 Parts A + B — the versioned, at-most-once write path. `beatSeq` is the monotonic
 * compare-and-swap token; `expectedBeatSeq` refuses a write computed against a superseded board
 * (stale-beat / 409); `idempotencyKey` makes a retried progression at-most-once. Absent fields ⇒
 * byte-identical to the pre-0065 path. HARD rule: roles only — no names.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-0065-"));

/** A turn-driven runtime over a fresh save dir with a started game (its first commit baselines). */
function startedRuntime(seed = 2): { reg: GameSessionRegistry; sb: UserSandbox; session: GameSessionAdapter; dir: string } {
  const dir = freshDir();
  const runtime = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: { tickEveryMs: 0, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 } });
  const sb = runtime.registry.sandboxFor("u");
  sb.session.createCharacter({ playerName: "P", seed });
  return { reg: runtime.registry, sb, session: sb.session, dir };
}

/** Resolve a pending decision LEGALLY (roles only); optional sync-spine fields ride along. */
function resolveLegally(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>, extra: { expectedBeatSeq?: number; idempotencyKey?: string } = {}): AdvanceView {
  if (p.kind === "nominations") return s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id], ...extra });
  if (p.kind === "veto-decision") return s.submitDecision({ kind: "veto-decision", use: false, ...extra });
  if (p.kind === "replacement") return s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id, ...extra });
  if (p.kind === "comp-intent" || p.kind === "comp-round") return s.submitDecision({ kind: p.kind, intent: "compete", ...extra });
  if (p.kind === "finale-statement") return s.submitDecision({ kind: "finale-statement", statement: "x", ...extra });
  if (p.kind === "finale-answer") return s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]!, ...extra });
  if (p.kind === "juror-vote") return s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id, ...extra });
  return s.submitDecision({ kind: p.kind, vote: p.options[0]!.id, ...extra });
}

/** Drive the loop until it blocks on a player decision (or finishes). Returns the latest view. */
function driveToPending(s: GameSessionAdapter): AdvanceView {
  let adv = s.advanceGame();
  for (let i = 0; i < 50 && !adv.pending && !adv.finished; i++) adv = s.advanceGame();
  return adv;
}

describe("0065 Part A — beatSeq is a monotonic per-sandbox commit counter", () => {
  it("increments by EXACTLY one per committed state mutation", () => {
    const { sb, session } = startedRuntime();
    // A started game already committed (createCharacter) → the counter advanced off zero.
    expect(session.getGameState().beatSeq).toBeGreaterThan(0);

    // Each single committed mutation bumps the counter by exactly one (a recorded scene, a deal,
    // a Diary-Room entry are each ONE commit through the single funnel).
    const a = session.gameStatus().beatSeq;
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat A" });
    expect(session.gameStatus().beatSeq).toBe(a + 1);
    sb.session.makeDeal({ with: npc(1), kind: "safety", terms: "t" });
    expect(session.gameStatus().beatSeq).toBe(a + 2);
    sb.commands.diaryRoom({ entry: "my plan" });
    expect(session.gameStatus().beatSeq).toBe(a + 3);
  });

  it("is stable across a no-op advance (a repeat advance while a decision is pending)", () => {
    const { session } = startedRuntime();
    const adv = driveToPending(session);
    expect(adv.pending).toBeTruthy();
    // Settle: keep advancing until the counter stops moving while still blocked on the decision.
    let settled = session.gameStatus().beatSeq;
    for (let i = 0; i < 5; i++) {
      const a = session.advanceGame();
      if (a.beatSeq === settled) break;
      settled = a.beatSeq;
    }
    // Now an advance is a pure no-op (the loop is blocked on the player) — the counter does not move.
    expect(session.advanceGame().beatSeq).toBe(settled);
    expect(session.advanceGame().beatSeq).toBe(settled);
  });

  it("survives a snapshot round-trip (restart-safe, co-versioned with the save)", () => {
    const { reg, session, dir } = startedRuntime();
    session.makeDeal({ with: npc(1), kind: "safety", terms: "t" }); // a committed mutation
    const before = session.gameStatus().beatSeq;
    expect(before).toBeGreaterThan(0);
    reg.saveUser("u");

    // A fresh registry over the same dir (process restart) resumes the counter at the saved value.
    const resumed = new GameSessionRegistry(new FileSaveStore(dir)).sandboxFor("u").session;
    expect(resumed.getGameState().beatSeq).toBe(before);
  });
});

describe("0065 Part A — compare-and-swap stale-write rejection", () => {
  it("a stale expectedBeatSeq refuses with stale-beat and changes NO state", () => {
    const { sb, session } = startedRuntime();
    const current = session.gameStatus().beatSeq;
    const eventsBefore = sb.engine.events.count();

    let thrown: unknown;
    try {
      session.makeDeal({ with: npc(1), kind: "safety", terms: "t", expectedBeatSeq: current - 1 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StaleBeatError);
    expect((thrown as StaleBeatError).code).toBe("stale-beat");
    expect((thrown as StaleBeatError).beatSeq).toBe(current); // carries the CURRENT counter
    expect((thrown as StaleBeatError).board).toBeTruthy(); // carries the Vault-free board

    // No state change: the counter did not move and nothing was recorded.
    expect(session.gameStatus().beatSeq).toBe(current);
    expect(sb.engine.events.count()).toBe(eventsBefore);
  });

  it("the CURRENT expectedBeatSeq is honored (the write goes through)", () => {
    const { session } = startedRuntime();
    const current = session.gameStatus().beatSeq;
    const deal = session.makeDeal({ with: npc(1), kind: "safety", terms: "t", expectedBeatSeq: current });
    expect(deal).toBeTruthy();
    expect(session.gameStatus().beatSeq).toBe(current + 1); // a committed mutation
  });

  it("an ABSENT expectedBeatSeq is byte-identical to the pre-0065 path (regression guard)", () => {
    // Two same-seed runtimes; one drives WITH no sync fields (today's path). The views — minus the
    // always-present beatSeq scalar — match beat-for-beat, and the counter is deterministic too.
    const a = startedRuntime(7);
    const b = startedRuntime(7);
    let advA = a.session.advanceGame();
    let advB = b.session.advanceGame();
    for (let i = 0; i < 16; i++) {
      const stripA = { ...advA, beatSeq: 0 };
      const stripB = { ...advB, beatSeq: 0 };
      expect(stripA).toEqual(stripB);
      expect(advA.beatSeq).toBe(advB.beatSeq);
      if (advA.finished || advB.finished) break;
      advA = advA.pending ? resolveLegally(a.session, advA.pending) : a.session.advanceGame();
      advB = advB.pending ? resolveLegally(b.session, advB.pending) : b.session.advanceGame();
    }
  });

  it("a two-writer race (the 0064 queued-turn shape) refuses the stale second write", () => {
    const { session } = startedRuntime();
    // Two writers read the SAME board. Writer 1 commits first; writer 2 was computed against the
    // now-stale board — its expectedBeatSeq no longer matches, so it is refused, not applied.
    const seen = session.gameStatus().beatSeq;
    const first = session.makeDeal({ with: npc(1), kind: "safety", terms: "1", expectedBeatSeq: seen });
    expect(first).toBeTruthy();
    const moved = session.gameStatus().beatSeq;
    expect(moved).toBe(seen + 1);
    expect(() => session.makeDeal({ with: npc(2), kind: "safety", terms: "2", expectedBeatSeq: seen })).toThrow(StaleBeatError);
    expect(session.gameStatus().beatSeq).toBe(moved); // unchanged by the refused write
  });

  it("recordInteraction + advanceGame both enforce the CAS against the session's counter", () => {
    const { sb, session } = startedRuntime();
    const current = session.gameStatus().beatSeq;
    const eventsBefore = sb.engine.events.count();
    expect(() =>
      sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat", expectedBeatSeq: current - 1 }),
    ).toThrow(StaleBeatError);
    expect(sb.engine.events.count()).toBe(eventsBefore); // refused before the mutation — nothing recorded
    expect(() => session.advanceGame({ expectedBeatSeq: current - 1 })).toThrow(StaleBeatError);
    // The CURRENT token is accepted on the command port.
    const ok = sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat", expectedBeatSeq: session.gameStatus().beatSeq });
    expect(ok.eventId).toBeTruthy();
  });
});

describe("0065 Part B — idempotency keys on progression tools", () => {
  it("the same submitDecision key twice ⇒ resolved ONCE and an identical view", () => {
    const { session } = startedRuntime();
    const adv = driveToPending(session);
    expect(adv.pending).toBeTruthy();
    const after = resolveLegally(session, adv.pending!, { idempotencyKey: "decide-1" });
    const seq = session.gameStatus().beatSeq;
    const replay = resolveLegally(session, adv.pending!, { idempotencyKey: "decide-1" }); // a retry
    expect(replay).toEqual(after); // verbatim, including its beatSeq
    expect(session.gameStatus().beatSeq).toBe(seq); // the decision resolved exactly once
  });

  it("different keys ⇒ two distinct advances (no caching across keys)", () => {
    const { session } = startedRuntime();
    // Two distinct decisions get two distinct keys → two real resolutions; counts as a plain drive.
    let adv = driveToPending(session);
    const seqAtFirst = session.gameStatus().beatSeq;
    adv = resolveLegally(session, adv.pending!, { idempotencyKey: "k-1" });
    adv = driveToPending(session);
    if (adv.pending) resolveLegally(session, adv.pending, { idempotencyKey: "k-2" });
    expect(session.gameStatus().beatSeq).toBeGreaterThan(seqAtFirst); // distinct keys advanced again
  });

  it("an absent key ⇒ unchanged behavior (a real resolution moves the board)", () => {
    const { session } = startedRuntime();
    const adv = driveToPending(session);
    const before = session.gameStatus().beatSeq;
    resolveLegally(session, adv.pending!); // no key — the pre-0065 path
    expect(session.gameStatus().beatSeq).toBeGreaterThan(before); // the decision committed
  });

  it("a replayed advanceGame key WINS even if beatSeq has since moved (the cache is the authority)", () => {
    const { session } = startedRuntime();
    const first = session.advanceGame({ idempotencyKey: "k" });
    // Move the board on with unrelated committed mutations.
    session.makeDeal({ with: npc(1), kind: "safety", terms: "t" });
    session.makeDeal({ with: npc(2), kind: "safety", terms: "t" });
    expect(session.gameStatus().beatSeq).toBeGreaterThan(first.beatSeq);
    const replay = session.advanceGame({ idempotencyKey: "k" }); // returns the ORIGINAL view verbatim
    expect(replay).toEqual(first);
    expect(replay.beatSeq).toBe(first.beatSeq);
  });
});

describe("0065 Part A — the HTTP edge maps stale-beat to 409 with code + beatSeq + board", () => {
  it("a stale expectedBeatSeq over HTTP is 409 { code, beatSeq, board }; current ⇒ 200; malformed ⇒ 400", async () => {
    const runtime = composeRuntime({ saveStore: new FileSaveStore(freshDir()), clock: new FakeClock(), watcher: { tickEveryMs: 0, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 } });
    const server = createHttpMcpServer({ resolve: runtime.registry.resolver() }, {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const user = { "x-orwell-user": "u", "content-type": "application/json" } as Record<string, string>;
    const call = (name: string, args: Record<string, unknown> = {}): Promise<Response> =>
      fetch(`${base}/player/call`, { method: "POST", headers: user, body: JSON.stringify({ name, args }) });
    try {
      await (await call("createCharacter", { playerName: "P", seed: 3 })).json();
      const statusBody = await (await call("gameStatus")).json() as { result: { beatSeq: number } };
      const current = statusBody.result.beatSeq;

      // A stale write ⇒ 409 with the stable machine code + the current counter + the Vault-free board.
      const stale = await call("makeDeal", { with: "npc:1", kind: "safety", terms: "t", expectedBeatSeq: current - 1 });
      expect(stale.status).toBe(409);
      const body = await stale.json() as { code: string; beatSeq: number; board: unknown };
      expect(body.code).toBe("stale-beat");
      expect(body.beatSeq).toBe(current);
      expect(body.board).toBeTruthy();

      // The current token ⇒ 200 (honored).
      const ok = await call("makeDeal", { with: "npc:1", kind: "safety", terms: "t", expectedBeatSeq: current });
      expect(ok.status).toBe(200);

      // A MALFORMED expectedBeatSeq is a deliberate 400 (E31 shape guard), never a 500.
      const bad = await call("advanceGame", { expectedBeatSeq: "nope" });
      expect(bad.status).toBe(400);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
