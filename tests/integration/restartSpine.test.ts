import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server, AddressInfo } from "node:net";
import { composeRuntime } from "../../src/composition/runtime";
import type { Runtime } from "../../src/composition/runtime";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { HealthRecord } from "../../src/composition/orchestrator";
import type { UserSaveStore } from "../../src/ports/UserSaveStore";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Audit E1 + D1 + R1 (end-to-end), E3, E7 (the HTTP mapping), and T14 — the missing tests the
 * audits named. Drives the REAL production object graph: `composeRuntime` (registry + orchestrator
 * commit hooks, pure turn-driven) behind `createHttpMcpServer`, exactly as `main.ts` composes it.
 * Roles only — no fixture names.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-restart-e2e-"));
const TURN_OFF = { tickEveryMs: 0, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 0, auditEveryMs: 0 };

interface Pending { kind: string; options: Array<{ id: string }>; appeals?: string[] }
interface Adv { started: boolean; finished: boolean; pending: Pending | null; status: { week: number } }

async function startHttp(runtime: Runtime): Promise<{ server: Server; base: string }> {
  const server = createHttpMcpServer({ resolve: runtime.registry.resolver() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function post(base: string, user: string, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/player/call`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-orwell-user": user },
    body: JSON.stringify({ name, args }),
  });
  return { status: res.status, body: (await res.json()) as { result?: unknown; error?: string } };
}

function decisionFor(p: Pending): Record<string, unknown> {
  switch (p.kind) {
    case "nominations": return { kind: p.kind, choice: [p.options[0]!.id, p.options[1]!.id] };
    case "veto-decision": return { kind: p.kind, use: false };
    case "comp-intent": return { kind: p.kind, intent: "compete" };
    case "finale-statement": return { kind: p.kind, statement: "x" };
    case "finale-answer": return { kind: p.kind, appeal: p.appeals![0]! };
    case "replacement": return { kind: p.kind, replacement: p.options[0]!.id };
    default: return { kind: p.kind, vote: p.options[0]!.id };
  }
}

/** Play N beats over HTTP, resolving pendings legally; every response must be 200. */
async function playBeatsHttp(base: string, user: string, beats: number): Promise<void> {
  for (let i = 0; i < beats; i++) {
    const adv = await post(base, user, "advanceGame");
    expect(adv.status, `advanceGame beat ${i}: ${JSON.stringify(adv.body)}`).toBe(200);
    const view = adv.body.result as Adv;
    if (view.pending) {
      const dec = await post(base, user, "submitDecision", decisionFor(view.pending));
      expect(dec.status, `submitDecision beat ${i}: ${JSON.stringify(dec.body)}`).toBe(200);
    }
    if (view.finished) break;
  }
}

describe("E1/D1/R1 end-to-end — season 2 survives an engine restart (the audit's missing test)", () => {
  it("play season 1 → restart via the sanctioned door → play season 2 → engine restart ⇒ season 2 persists", async () => {
    const dir = freshDir();
    const user = "e2e";

    // ── Engine process #1: play season 1, restart through the FE's door, start season 2. ──
    const r1 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
    const { server, base } = await startHttp(r1);
    try {
      const created = await post(base, user, "createCharacter", { playerName: "The Player", seed: 101 });
      expect(created.status).toBe(200);
      await playBeatsHttp(base, user, 12); // season 1 accrues real, persisted history
      const season1Week = r1.registry.sandboxFor(user).session.snapshot().week;

      // The sanctioned restart door, over the wire (the FE reset path: createCharacter+confirmRestart).
      const restarted = await post(base, user, "createCharacter", {
        playerName: "The Player", seed: 202, confirmRestart: true,
      });
      expect(restarted.status).toBe(200); // a fault here would be 4xx — and would fail this test
      expect((restarted.body.result as { started: boolean }).started).toBe(true);

      // Season 2 plays CLEAN: commits succeed (no degradation-vs-dead-season faults, no 409s)…
      await playBeatsHttp(base, user, 6);
      const health = r1.orchestrator.sandboxHealth(user) as HealthRecord;
      expect(health.lastIntegrity).toBe("ok");
      expect(health.faults).toEqual([]);
      expect(health.circuitOpen).toBe(false);
      expect(season1Week).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // ── Engine process #2 (the restart): a fresh runtime over the SAME data dir. ──
    const r2 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
    const resumed = r2.registry.sandboxFor(user);
    // THE BUG (R1 step 4): the latest durable save used to still hold season 1 — a player who
    // finished a season, restarted, and played for hours got their finished season back.
    expect(resumed.session.snapshot().seed).toBe(202); // season 2, not the dead season
    expect(resumed.session.getGameState().started).toBe(true);

    // And the resumed season keeps committing clean (the seeded baseline accepts its own state).
    const { server: s2, base: b2 } = await startHttp(r2);
    try {
      await playBeatsHttp(b2, user, 4);
      expect((r2.orchestrator.sandboxHealth(user) as HealthRecord).lastIntegrity).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => s2.close(() => resolve()));
    }
  }, 60_000);
});

describe("E3 — a faulted commit surfaces as an ERROR to the caller (never 200-then-rollback)", () => {
  it("an integrity-refused advanceGame returns 409 over HTTP and the state is unchanged", async () => {
    const runtime = composeRuntime({ clock: new FakeClock(), watcher: TURN_OFF });
    const user = "fault-409";
    const { server, base } = await startHttp(runtime);
    const errSpy: Array<() => void> = [];
    const restore = (() => {
      const orig = console.error;
      console.error = () => {};
      errSpy.push(() => { console.error = orig; });
      return errSpy[0]!;
    })();
    try {
      await post(base, user, "createCharacter", { playerName: "The Player", seed: 31 });

      // Inject a Vault leak the fail-closed checkpoint must refuse: the same secret hidden AND visible.
      const SECRET = "LEAK-E3-SENTINEL";
      const sb = runtime.registry.sandboxFor(user);
      sb.engine.events.record({ id: "e3:h", ts: 1, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: `secret ${SECRET}` });
      sb.engine.events.record({ id: "e3:v", ts: 2, type: "house-event", initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content: `secret ${SECRET}` });

      const adv = await post(base, user, "advanceGame");
      expect(adv.status).toBe(409); // the request FAILED — the FE can never narrate this beat
      expect(adv.body.error).toMatch(/turn refused/);
      expect(adv.body.error).not.toContain(SECRET); // fault KINDS only, never content

      // The state the caller can read is the ROLLED-BACK state — the leak never happened.
      const state = await post(base, user, "getGameState");
      expect(state.status).toBe(200);
      expect(JSON.stringify(state.body)).not.toContain(SECRET);
      expect((runtime.orchestrator.sandboxHealth(user) as HealthRecord).lastIntegrity).toBe("fault");
    } finally {
      restore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("a persist failure returns a sanitized 500 (E7) — not a 400 blaming the caller, no path leak", async () => {
    class DoomedStore implements UserSaveStore {
      failing = false;
      inner = new Map<string, SessionSnapshot>();
      saveFor(user: string, snapshot: SessionSnapshot): void {
        if (this.failing) throw new Error("ENOSPC: no space left on device, write '/srv/orwell/.orwell-data/v2.json'");
        this.inner.set(user, snapshot);
      }
      hasSave(user: string): boolean { return this.inner.has(user); }
      loadLatest(user: string): SessionSnapshot | null { return this.inner.get(user) ?? null; }
    }
    const store = new DoomedStore();
    const runtime = composeRuntime({ saveStore: store, clock: new FakeClock(), watcher: TURN_OFF });
    const user = "disk-500";
    const { server, base } = await startHttp(runtime);
    const orig = console.error;
    console.error = () => {};
    try {
      await post(base, user, "createCharacter", { playerName: "The Player", seed: 41 });
      store.failing = true;
      const adv = await post(base, user, "advanceGame");
      expect(adv.status).toBe(500);
      expect(adv.body.error).toMatch(/could not be saved/);
      expect(adv.body.error).not.toMatch(/orwell-data|\/srv\//); // sanitized — no data-dir path
    } finally {
      console.error = orig;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("T14 — restore into a FRESH registry, then tick (the B71 regression the smoke found live)", () => {
  it("save mid-game → new registry over the same dir → 5 off-screen ticks ⇒ integrity ok + unique event ids", () => {
    const dir = freshDir();
    const user = "t14";
    {
      const r1 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
      const sb = r1.registry.sandboxFor(user);
      sb.session.createCharacter({ playerName: "The Player", seed: 77 });
      sb.session.advanceGame(); // mid-game: a beat + its off-screen tick are persisted
    }
    // A fresh process over the same save dir (the engine-restart shape).
    const r2 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
    for (let i = 0; i < 5; i++) {
      const res = r2.orchestrator.advance(user, "offscreen-tick");
      expect(res.integrity, `tick ${i}: ${JSON.stringify(res.faults)}`).toBe("ok");
    }
    const ids = r2.registry.sandboxFor(user).engine.events.query().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids minted by the resumed tick streams
    expect((r2.orchestrator.sandboxHealth(user) as HealthRecord).lastIntegrity).toBe("ok");
  });
});
