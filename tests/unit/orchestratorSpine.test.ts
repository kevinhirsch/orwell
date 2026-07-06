import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime } from "../../src/composition/runtime";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { HealthRecord } from "../../src/composition/orchestrator";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature B41 / audit E3 — the orchestrator is the real per-sandbox spine. Player mutations now
 * commit through the fail-closed checkpoint (a leak is rolled back, not saved), `touch` the user
 * (so the watcher stops flooding off-screen ticks mid-scene), and in turn-driven mode fire one
 * bounded off-screen tick per turn. HARD rule: roles only — no names.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-b41-"));
const hidden = (sb: { engine: { events: { queryAll(): { hidden: boolean }[] } } }): number =>
  sb.engine.events.queryAll().filter((e) => e.hidden).length;

function resolveLegally(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

describe("B41 — every player turn commits through the fail-closed checkpoint", () => {
  it("a leaky player-turn commit is rolled back and never persisted", () => {
    const dir = freshDir();
    const runtime = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: { tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 } });
    const sb = runtime.registry.sandboxFor("u");
    sb.session.createCharacter({ playerName: "P", seed: 2 }); // first commit → clean baseline

    // Inject a leak: a hidden secret whose content ALSO appears in a player-witnessed event.
    const SECRET = "LEAK-B41-SENTINEL";
    sb.engine.events.record({ id: "leak:h", ts: 1, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: `secret ${SECRET}` });
    sb.engine.events.record({ id: "leak:v", ts: 2, type: "house-event", initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content: `secret ${SECRET}` });

    // The checkpoint must catch the leak — and the refusal FAILS the commit call itself
    // (audit E3): a typed error, never a silent 200-then-rollback.
    expect(() => runtime.orchestrator.commitPlayerTurn("u")).toThrowError(/turn refused/);

    // Rolled back in memory…
    expect(runtime.registry.sandboxFor("u").engine.events.queryAll().some((e) => e.content.includes(SECRET))).toBe(false);
    // …and never persisted (the prior good save is intact).
    expect(JSON.stringify(new FileSaveStore(dir).loadLatest("u")!).includes(SECRET)).toBe(false);
    expect((runtime.orchestrator.sandboxHealth("u") as HealthRecord).lastIntegrity).toBe("fault");
  });

  it("health shows lastTrigger='player-turn' after a real player call", async () => {
    const runtime = composeRuntime({ clock: new FakeClock(), watcher: { tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 } });
    await runtime.registry.resolver()("player", "u").callTool("createCharacter", { playerName: "P", seed: 2 });
    expect((runtime.orchestrator.sandboxHealth("u") as HealthRecord).lastTrigger).toBe("player-turn");
  });
});

describe("B41 — the idle gate no longer floods", () => {
  it("an actively-calling user accrues no off-screen ticks until idle, then the house lives", () => {
    const clock = new FakeClock();
    const runtime = composeRuntime({ saveStore: new FileSaveStore(freshDir()), clock, watcher: { tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 } });
    const sb = runtime.registry.sandboxFor("u");
    sb.session.createCharacter({ playerName: "P", seed: 2 }); // touch at t0 (commitPlayerTurn)
    runtime.start();

    const afterCreate = hidden(sb);
    clock.advance(1000); // a watcher wake while the user is ACTIVE (touched 1s ago < 5s idle gate)
    expect(hidden(runtime.registry.sandboxFor("u"))).toBe(afterCreate); // no off-screen flood mid-scene

    clock.advance(6000); // now well past the idle gate since the last call
    expect(hidden(runtime.registry.sandboxFor("u"))).toBeGreaterThan(afterCreate); // the house lives while away
    runtime.stop();
  });
});

describe("B41 — pure turn-driven mode keeps the house alive", () => {
  it("with the watcher disabled, N player turns still grow the hidden off-screen life", () => {
    const runtime = composeRuntime({ saveStore: new FileSaveStore(freshDir()), clock: new FakeClock(), watcher: { tickEveryMs: 0, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 } });
    const sb = runtime.registry.sandboxFor("u");
    sb.session.createCharacter({ playerName: "P", seed: 2 });
    const before = hidden(sb);

    for (let i = 0; i < 5; i++) {
      const adv = sb.session.advanceGame(); // each player turn fires one bounded off-screen tick
      if (adv.pending) resolveLegally(sb.session, adv.pending);
      if (adv.finished) break;
    }
    expect(hidden(runtime.registry.sandboxFor("u"))).toBeGreaterThan(before);
  });
});
