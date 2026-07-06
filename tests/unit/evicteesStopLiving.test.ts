import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView, SubmitDecisionReq } from "../../src/ports/GameSession";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature B52 (audit D5) — evicted houseguests STOP living. An evictee must drop out of every live
 * pool the moment they go: no off-screen scheming, no confessionals, no "wants a word", no competition
 * eligibility — weeks after leaving (a fidelity break the player would notice). The jury still forms
 * from them; they just stop ACTING. HARD rule: roles only — no names.
 */

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  const submit = (req: SubmitDecisionReq): void => void s.submitDecision(req);
  if (p.kind === "nominations") submit({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") submit({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") submit({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-intent") submit({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") submit({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") submit({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") submit({ kind: "juror-vote", vote: p.options[0]!.id });
  else submit({ kind: p.kind, vote: p.options[0]!.id });
}

/** Drive the live loop until at least `n` houseguests have been evicted; return the evictee ids. */
function driveToEvictions(reg: GameSessionRegistry, user: string, seed: number, n: number): EntityId[] {
  const s = reg.sandboxFor(user).session;
  s.createCharacter({ playerName: "P", seed });
  for (let i = 0; i < 400; i++) {
    const v = s.advanceGame();
    if (v.pending) resolve(s, v.pending);
    if ((s.snapshot().live?.evictionOrder?.length ?? 0) >= n) break;
    if (v.finished) break;
  }
  return [...(reg.sandboxFor(user).session.snapshot().live?.evictionOrder ?? [])];
}

describe("B52 — an evictee leaves the off-screen society", () => {
  it("records no post-eviction off-screen scene or confessional that involves an evictee", () => {
    const reg = new GameSessionRegistry();
    const user = "u-evict";
    const evictees = driveToEvictions(reg, user, 2, 2);
    expect(evictees.length).toBeGreaterThanOrEqual(2);
    const evicted = new Set(evictees);
    const sb = reg.sandboxFor(user);

    // Everything recorded from here on must exclude the evictees.
    const cut = sb.engine.events.queryAll().length;
    const orch = new Orchestrator(reg, new FakeClock(), { seed: 2 });
    for (let i = 0; i < 12; i++) orch.advance(user, "offscreen-tick");

    const fresh = sb.engine.events.queryAll().slice(cut);
    const offscreen = fresh.filter((e) => e.id.startsWith("offscreen:") || e.type === "confessional");
    expect(offscreen.length).toBeGreaterThan(0); // the living house DID keep scheming (not a vacuous pass)
    for (const e of offscreen) {
      for (const id of [e.initiator, ...e.witnessSet]) {
        expect(evicted.has(id), `evictee ${id} still active in ${e.id}`).toBe(false);
      }
    }
  });
});

describe("B52 — an evictee leaves the other live pools", () => {
  it("never 'wants a word' (socialInitiatives) once evicted", () => {
    const reg = new GameSessionRegistry();
    const user = "u-soc";
    const evicted = new Set(driveToEvictions(reg, user, 5, 3));
    const s = reg.sandboxFor(user).session;
    // Across several moments (the approach set is per-week/phase), no evictee is ever offered.
    for (let i = 0; i < 8; i++) {
      for (const init of s.socialInitiatives()) {
        expect(evicted.has(init.houseguest.id), `evictee ${init.houseguest.id} wants a word`).toBe(false);
      }
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
      if (v.finished) break;
    }
  });

  it("is not eligible for a competition once evicted (rejected as a participant; never the default winner)", () => {
    const reg = new GameSessionRegistry();
    const user = "u-comp";
    const evictees = driveToEvictions(reg, user, 7, 2);
    const s = reg.sandboxFor(user).session;
    const evictee = evictees[0]!;

    // A caller naming an evictee is rejected (no winner crowned over an ineligible field).
    const named = s.runCompetition({ type: "endurance", participantIds: [evictee] });
    expect(named.winner).toBeNull();

    // The engine's own default pool never returns an evicted winner.
    const def = s.runCompetition({ type: "endurance" });
    if (def.winner) expect(evictees.includes(def.winner.id)).toBe(false);
  });
});
