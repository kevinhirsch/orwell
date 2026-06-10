import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView, SubmitDecisionReq } from "../../src/ports/GameSession";

/** A simple, deterministic player policy: compete, take the first legal options, never use the veto. */
function resolvePending(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
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

describe("0015/agent — engine-owned live competition resolution", () => {
  it("no game in progress → started:false, no winner, no throw", () => {
    const s = new GameSessionAdapter();
    const r = s.runCompetition({ type: "endurance" });
    expect(r.started).toBe(false);
    expect(r.winner).toBeNull();
  });

  it("resolves over the live house and returns only the winner's name (Vault-free)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 7 });
    const state = s.getGameState();
    const names = new Set([state.player!.name, ...state.house.map((h) => h.name)]);
    const ids = new Set([state.player!.id, ...state.house.map((h) => h.id)]);

    const r = s.runCompetition({ type: "endurance" });
    expect(r.started).toBe(true);
    expect(r.winner).not.toBeNull();
    expect(ids.has(r.winner!.id)).toBe(true);
    expect(names.has(r.winner!.name)).toBe(true);

    // The outcome carries ONLY {started,type,week,phase,winner:{id,name}} — no stats/scores/soul.
    const blob = JSON.stringify(r);
    for (const banned of ["physical", "mental", "social", "score", "soul", "stats", "emotional"]) {
      expect(blob.includes(banned)).toBe(false);
    }
  });

  it("is deterministic per moment (same week/phase/type → same winner)", () => {
    const a = new GameSessionAdapter(); a.createCharacter({ playerName: "P", seed: 42 });
    const b = new GameSessionAdapter(); b.createCharacter({ playerName: "P", seed: 42 });
    expect(a.runCompetition({ type: "puzzle" })).toEqual(b.runCompetition({ type: "puzzle" }));
  });

  it("an unknown competition type falls back to a valid one (no throw)", () => {
    const s = new GameSessionAdapter(); s.createCharacter({ playerName: "P", seed: 1 });
    const r = s.runCompetition({ type: "banana" });
    expect(r.started).toBe(true);
    expect(r.winner).not.toBeNull();
  });
});

describe("0037/B26 — finaleView read tool", () => {
  it("is null before a finale, mirrors AdvanceView.finale during one (Vault-free), and is null once finished", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 2 });
    expect(s.finaleView()).toBeNull(); // no finale is staging yet

    let sawFinale = false;
    let finished = false;
    for (let i = 0; i < 6000 && !finished; i++) {
      const adv = s.advanceGame();
      if (adv.finale && !adv.finished) {
        sawFinale = true;
        // The read tool returns the SAME Vault-free projection the advance already carries.
        expect(s.finaleView()).toEqual(adv.finale);
        const blob = JSON.stringify(s.finaleView());
        expect(/"votes"|"script"|"tally"|"lean"|"manner"/i.test(blob)).toBe(false); // no pre-reveal internals
      }
      if (adv.pending) resolvePending(s, adv.pending);
      finished = adv.finished;
    }
    expect(sawFinale).toBe(true);
    expect(s.finaleView()).toBeNull(); // the game is over — nothing staging
  });
});
