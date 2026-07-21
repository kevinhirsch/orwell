import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import type { McpServer } from "../../src/adapters/mcp/McpServer";
import { GameSessionRegistry } from "../../src/composition/registry";
import { composeRuntime } from "../../src/composition/runtime";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * B60 — transport robustness + determinism (audit E9–E12). Roles only — no fixture names.
 */

async function withServer(
  deps: Parameters<typeof createHttpMcpServer>[0],
  fn: (base: string) => Promise<void>,
  options?: Parameters<typeof createHttpMcpServer>[1],
): Promise<void> {
  const server = createHttpMcpServer(deps, options);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const liveResolver = () => new GameSessionRegistry().resolver();

describe("E9 — request hygiene", () => {
  it("an oversize body is rejected with 413", async () => {
    await withServer({ resolve: liveResolver() }, async (base) => {
      const res = await fetch(`${base}/player/call`, {
        method: "POST",
        body: JSON.stringify({ name: "getGameState", args: { pad: "x".repeat(300 * 1024) } }),
      }).catch(() => null);
      // The server answers 413 (or resets the socket after answering) — never a 200.
      if (res) expect(res.status).toBe(413);
    });
  });

  it("a malformed tool name / non-object args are 400s", async () => {
    await withServer({ resolve: liveResolver() }, async (base) => {
      const bad1 = await fetch(`${base}/player/call`, { method: "POST", body: JSON.stringify({ args: {} }) });
      expect(bad1.status).toBe(400);
      const bad2 = await fetch(`${base}/player/call`, { method: "POST", body: JSON.stringify({ name: "getGameState", args: [1] }) });
      expect(bad2.status).toBe(400);
    });
  });

  it("a deliberate engine refusal is 400; an engine BUG is 500", async () => {
    const buggy = {
      listTools: () => [{ name: "boom", channel: "player", readsVault: false, description: "" }],
      callTool: async (name: string) => {
        if (name === "refuse") throw new Error("a deliberate refusal");
        throw new TypeError("an engine bug");
      },
    } as unknown as McpServer;
    await withServer({ player: buggy, admin: buggy }, async (base) => {
      const bug = await fetch(`${base}/player/call`, { method: "POST", body: JSON.stringify({ name: "boom" }) });
      expect(bug.status).toBe(500); // TypeError must not masquerade as a client error
      const refusal = await fetch(`${base}/player/call`, { method: "POST", body: JSON.stringify({ name: "refuse" }) });
      expect(refusal.status).toBe(400);
      expect(((await refusal.json()) as { error: string }).error).toContain("deliberate");
    });
  });
});

describe("E10 — per-user serialization", () => {
  it("two in-flight calls for the same user run in order; other users run concurrently", async () => {
    const order: string[] = [];
    const gate: { release?: () => void } = {};
    const slow = {
      callTool: async (name: string) => {
        if (name === "slow") {
          await new Promise<void>((r) => { gate.release = r; });
          order.push("slow-done");
        } else {
          order.push(`${name}-done`);
        }
        return {};
      },
    } as unknown as McpServer;
    await withServer({ resolve: () => slow }, async (base) => {
      const call = (name: string, user: string) =>
        fetch(`${base}/player/call`, { method: "POST", headers: { "x-orwell-user": user }, body: JSON.stringify({ name }) });
      const a1 = call("slow", "user-a");
      await new Promise((r) => setTimeout(r, 30));
      const a2 = call("fast", "user-a"); // same user: must WAIT behind the slow call
      const b1 = call("other", "user-b"); // different user: runs immediately
      await b1;
      expect(order).toEqual(["other-done"]); // user-a's queue is still blocked; user-b sailed through
      gate.release!();
      await Promise.all([a1, a2]);
      expect(order).toEqual(["other-done", "slow-done", "fast-done"]); // strict per-user order
    });
  });
});

describe("#1713 — per-request response-budget watchdog", () => {
  it("answers a call queued behind a saturating prior call with a typed 503 within the budget, " +
     "never lets the client wait for the whole queue to drain, and never ghost-dispatches the refused job",
  async () => {
    const order: string[] = [];
    const gate: { release?: () => void } = {};
    // Simulates the createCharacter→premiere contention scenario: one call (e.g. the model-authored
    // cast genesis grind) holds the queue open far longer than any caller should ever have to wait,
    // while a second call for the SAME user (e.g. the very next turn) sits queued behind it.
    const contended = {
      listTools: () => [],
      callTool: async (name: string) => {
        if (name === "createCharacter") {
          await new Promise<void>((r) => { gate.release = r; });
          order.push("createCharacter-done");
          return { started: true };
        }
        order.push(`${name}-dispatched`); // must NEVER fire for the refused call
        return {};
      },
    } as unknown as McpServer;

    await withServer({ resolve: () => contended }, async (base) => {
      const call = (name: string) =>
        fetch(`${base}/player/call`, {
          method: "POST", headers: { "x-orwell-user": "user-a" }, body: JSON.stringify({ name }),
        });

      const slow = call("createCharacter"); // dispatches immediately, then hangs on the gate
      // Give the slow call a moment to actually dispatch before queuing the second one behind it —
      // mirrors the real ordering (finalize dispatches, THEN the next turn queues behind it).
      await new Promise((r) => setTimeout(r, 20));
      const t0 = Date.now();
      const queued = await call("advanceGame"); // same user: queues behind the still-running createCharacter
      const waited = Date.now() - t0;

      // The queued call is answered with a typed, retriable 503 — it NEVER waits for the whole
      // queue (the saturating call is still hanging on the gate at this point) — the structural
      // guarantee at the heart of #1713: no caller can be left waiting minutes for an answer.
      expect(queued.status).toBe(503);
      const body = (await queued.json()) as { code: string; error: string };
      expect(body.code).toBe("engine-busy");
      expect(waited).toBeLessThan(2000); // bounded by the budget — nowhere near a multi-minute hang

      // The refused job never actually dispatched (no ghost-mutation of the sandbox after the
      // caller was already told it failed) — it was still queued behind createCharacter when its
      // own deadline fired.
      expect(order).not.toContain("advanceGame-dispatched");

      // Releasing the gate lets the ALREADY-DISPATCHED createCharacter call's real work finish in
      // the background — the watchdog only bounds the ANSWER, it never kills in-flight work. (Its
      // own HTTP response may itself have already been forced to a 503 once its budget elapsed —
      // the same abandonment semantics as a caller-side timeout today — but the underlying call
      // keeps running to completion rather than being aborted.)
      gate.release!();
      await slow;
      expect(order).toContain("createCharacter-done");

      // The failure is visible on /health (G1) under its own error class.
      const health = (await (await fetch(`${base}/health`)).json()) as {
        recentFailures: Array<{ tool: string; errorClass: string }>;
      };
      expect(health.recentFailures.some((f) => f.errorClass === "ResponseBudgetExceeded")).toBe(true);
    }, { responseBudgetMs: 60 });
  });

  it("does not fire when the call is answered comfortably inside the budget", async () => {
    const quick = {
      listTools: () => [],
      callTool: async () => ({ ok: true }),
    } as unknown as McpServer;
    await withServer({ resolve: () => quick }, async (base) => {
      const res = await fetch(`${base}/player/call`, {
        method: "POST", body: JSON.stringify({ name: "getGameState" }),
      });
      expect(res.status).toBe(200);
      const health = (await (await fetch(`${base}/health`)).json()) as {
        recentFailures: Array<{ errorClass: string }>;
      };
      expect(health.recentFailures.some((f) => f.errorClass === "ResponseBudgetExceeded")).toBe(false);
    }, { responseBudgetMs: 5000 });
  });
});

describe("E11 — saved users preload at boot", () => {
  it("a restarted runtime resumes every saved user without waiting for their next request", () => {
    const dir = mkdtempSync(join(tmpdir(), "orwell-preload-"));
    try {
      const store = new FileSaveStore(dir);
      // Boot 1: two users start games (persisted on mutation).
      const rt1 = composeRuntime({ saveStore: store, clock: new FakeClock() });
      rt1.registry.sandboxFor("resume-a").session.createCharacter({ playerName: "The Player", seed: 1 });
      rt1.registry.sandboxFor("resume-b").session.createCharacter({ playerName: "The Player", seed: 2 });
      // Boot 2 (a deploy): the same store — both users are LIVE at boot, no request needed.
      const rt2 = composeRuntime({ saveStore: store, clock: new FakeClock() });
      expect(rt2.registry.usernames().sort()).toEqual(["resume-a", "resume-b"]);
      expect(rt2.knownUser("resume-a")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("E12 — determinism hygiene", () => {
  it("two SAME-NAMED games with different seeds play different seasons", () => {
    const play = (seed: number): string => {
      const reg = new GameSessionRegistry();
      const s = reg.sandboxFor(`e12-${seed}`).session;
      s.createCharacter({ playerName: "The Player", seed });
      for (let i = 0; i < 300; i++) {
        const v = s.advanceGame();
        if (v.pending) {
          const p = v.pending;
          if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
          else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
          else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
          else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
          else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
          else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
        }
        if (v.status.week >= 4) break;
      }
      return s.snapshot().live!.evictionOrder.join("|");
    };
    // Identical player NAME; the games still diverge (the rng keys off the persisted game seed).
    expect(play(101)).not.toBe(play(202));
  });

  it("the per-moment rng stream survives a restart (the seed is persisted)", () => {
    const reg = new GameSessionRegistry();
    const user = "e12-resume";
    const s = reg.sandboxFor(user).session;
    s.createCharacter({ playerName: "The Player", seed: 303 });
    const preview = s.runCompetition({}).winner?.id;
    const reg2 = new GameSessionRegistry();
    reg2.restore(user, reg.snapshot(user));
    expect(reg2.sandboxFor(user).session.runCompetition({}).winner?.id).toBe(preview);
  });

  it("event ts is one coherent monotonic tick per sandbox", () => {
    const events = new InMemoryEventStore();
    events.record({ id: "a", ts: 5, type: "x", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: "a" });
    events.record({ id: "b", ts: 1, type: "x", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: "b" }); // would go backwards
    events.record({ id: "c", ts: 100, type: "x", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "c" });
    const ts = events.queryAll().map((e) => e.ts);
    expect(ts).toEqual([...ts].sort((x, y) => x - y));
    expect(new Set(ts).size).toBe(ts.length); // strictly increasing — ordering by ts is meaningful
    // …and a real driven game's record is coherent too.
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("e12-ts");
    sb.session.createCharacter({ playerName: "The Player", seed: 9 });
    for (let i = 0; i < 30; i++) {
      const v = sb.session.advanceGame();
      if (v.pending) break;
    }
    const live = sb.engine.events.queryAll().map((e) => e.ts);
    expect(live).toEqual([...live].sort((x, y) => x - y));
  });
});
