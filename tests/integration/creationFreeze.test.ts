import { describe, it, expect, afterEach } from "vitest";
import type { Server, AddressInfo } from "node:net";
import { composeRuntime } from "../../src/composition/runtime";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import { setRuntimeEmbedding } from "../../src/composition/engineRoot";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { FakeClock } from "../../src/adapters/time/FakeClock";

/**
 * Lane G8 — "casting finalization breathes". USER REPORT: filing away the interview
 * (createCharacter) stalled the engine long enough that the front-end's /health probe
 * timed out and flashed "engine unreachable". The cause: creation-time soul seeding
 * runs through the SYNCHRONOUS embedding bridge (ADR 0004 — each embed blocks the
 * Node event loop), and the batch ran back-to-back inside one call.
 *
 * This test drives the REAL production object graph (composeRuntime — registry +
 * orchestrator commit + the turn-driven off-screen tick — behind createHttpMcpServer,
 * exactly as main.ts composes it) with a provider that blocks the loop per call the
 * same way the worker bridge does (Atomics.wait), and PROVES /health answers fast
 * (<500ms) WHILE the seeding batch is in flight and draining. Roles only — no names.
 */

const TURN_OFF = { tickEveryMs: 0, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 0, auditEveryMs: 0 };

/** Per-call loop budget for the fake slow model. Big enough that a back-to-back batch
 *  (~6+ embeds at creation) would blow the 500ms health budget pre-fix; small enough
 *  that a single spaced call never does. */
const EMBED_SLEEP_MS = 120;
const HEALTH_BUDGET_MS = 500;

/** A SYNC provider that pins the event loop per call exactly like the ADR 0004 bridge. */
function slowSyncProvider(sleepMs: number): { calls: () => number; embed: (t: string) => number[] } {
  const inner = new DeterministicEmbedding();
  let n = 0;
  return {
    calls: () => n,
    embed: (text: string): number[] => {
      n++;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs); // a blocked loop, like real inference
      return inner.embed(text);
    },
  };
}

let server: Server | undefined;

afterEach(async () => {
  setRuntimeEmbedding(null); // never leak the slow provider into other suites
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe("G8 — /health answers during the creation-time soul-seeding batch", () => {
  it("createCharacter with a slow sync embedder: every concurrent /health probe answers <500ms", async () => {
    const provider = slowSyncProvider(EMBED_SLEEP_MS);
    setRuntimeEmbedding(provider);
    const runtime = composeRuntime({ clock: new FakeClock(), watcher: TURN_OFF });
    server = createHttpMcpServer({ resolve: runtime.registry.resolver() });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const user = "g8";

    const post = async (name: string, args: Record<string, unknown> = {}): Promise<Response> =>
      fetch(`${base}/player/call`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-orwell-user": user },
        body: JSON.stringify({ name, args }),
      });

    // The casting interview lands its material first (0050) — the batch indexes from it too.
    const casting = await post("updateCasting", {
      playerName: "The Player",
      motivation: "to outlast the house",
      interviewNotes: Array.from({ length: 6 }, (_, i) => `interview detail ${i} worth remembering`),
    });
    expect(casting.status).toBe(200);

    // Concurrent health prober — CONTINUOUS (one probe always in flight), so a pinned loop is
    // guaranteed to be caught by an in-flight request, exactly like the FE's out-of-process poll.
    let probing = true;
    const latencies: number[] = [];
    const prober = (async () => {
      while (probing) {
        const t0 = performance.now();
        const r = await fetch(`${base}/health`);
        expect(r.status).toBe(200);
        await r.text();
        latencies.push(performance.now() - t0);
      }
    })();
    // Event-loop heartbeat: the max inter-tick gap is the longest stretch ANY request (incl.
    // /health) could possibly be stalled — a deterministic, race-free read of the pin.
    let beating = true;
    let maxStallMs = 0;
    const heartbeat = (async () => {
      let prev = performance.now();
      while (beating) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const now = performance.now();
        maxStallMs = Math.max(maxStallMs, now - prev - 5);
        prev = now;
      }
    })();

    const t0 = performance.now();
    const created = await post("createCharacter", { seed: 7 });
    const createMs = performance.now() - t0;
    expect(created.status).toBe(200);
    expect(((await created.json()) as { result: { started: boolean } }).result.started).toBe(true);

    // Keep probing until the deferred seeding batch has fully drained: the call count must be
    // UNCHANGED across a window comfortably wider than one per-call sleep (no premature exit
    // while the loop is pinned inside a single slow embed).
    let last = -1;
    for (let i = 0; i < 100 && provider.calls() !== last; i++) {
      last = provider.calls();
      await new Promise((resolve) => setTimeout(resolve, EMBED_SLEEP_MS * 2));
    }
    probing = false;
    beating = false;
    await prober;
    await heartbeat;

    // The seeding batch genuinely ran through the slow sync seam (back-to-back it would have
    // pinned the loop for ~calls × EMBED_SLEEP_MS — well past the health budget).
    expect(provider.calls()).toBeGreaterThanOrEqual(4);
    expect(provider.calls() * EMBED_SLEEP_MS).toBeGreaterThan(HEALTH_BUDGET_MS);
    expect(latencies.length).toBeGreaterThan(5);
    // THE CLAIM: the loop breathed throughout — no probe ever waited out a back-to-back batch…
    const worst = Math.max(...latencies);
    expect(worst, `worst /health latency ${worst.toFixed(0)}ms (probes: ${latencies.length}, embeds: ${provider.calls()})`)
      .toBeLessThan(HEALTH_BUDGET_MS);
    // …and the loop itself NEVER stalled past the budget (deterministic — no probe-timing race).
    expect(maxStallMs, `max event-loop stall ${maxStallMs.toFixed(0)}ms`).toBeLessThan(HEALTH_BUDGET_MS);
    // And the player-facing call itself no longer carries the whole batch inline.
    expect(createMs).toBeLessThan(5000);
  }, 30_000);
});
