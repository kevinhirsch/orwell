import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView } from "../../src/ports/GameSession";

/**
 * Round-2 finding: the decision-card reload re-arm read a FE-process-local cache, so a FE restart
 * or an out-of-band advance left the card unable to re-arm while the engine waited. Fix: gameStatus
 * exposes the live pending (Vault-free legal options) so /status reads ENGINE truth. Roles only.
 */
type Pending = NonNullable<AdvanceView["pending"]>;
function resolve(s: GameSessionAdapter, p: Pending): void {
  const o = (i = 0): string => p.options[i]?.id;
  switch (p.kind) {
    case "nominations": s.submitDecision({ kind: "nominations", choice: [o(0), o(1)] }); break;
    case "veto-decision": s.submitDecision({ kind: "veto-decision", use: false }); break;
    case "comp-intent": s.submitDecision({ kind: "comp-intent", intent: "compete" }); break;
    case "houseguests-choice": s.submitDecision({ kind: "houseguests-choice", choice: [o(0)] }); break;
    case "replacement": s.submitDecision({ kind: "replacement", replacement: o(0) }); break;
    case "eviction-vote": s.submitDecision({ kind: "eviction-vote", vote: o(0) }); break;
    case "goodbye-message": s.submitDecision({ kind: "goodbye-message", vote: o(0), statement: "x" }); break;
    default: s.submitDecision({ kind: (p as any).kind, vote: o(0) }); break;
  }
}

describe("gameStatus.pending mirrors the live decision (engine-backed reload re-arm)", () => {
  it("carries the SAME pending the advance surfaced, and clears when none is open", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 4 });
    let sawPendingMirror = false, sawNullMirror = false;
    for (let i = 0; i < 60; i++) {
      const adv = s.advanceGame();
      const stp = s.gameStatus().pending;
      if (adv.pending) { expect(stp).toEqual(adv.pending); sawPendingMirror = true; resolve(s, adv.pending); }
      else { expect(stp).toBeNull(); sawNullMirror = true; }
      if (adv.finished) break;
    }
    expect(sawPendingMirror, "gameStatus mirrored a live pending").toBe(true);
    expect(sawNullMirror, "gameStatus was null on a no-pending beat").toBe(true);
  });
});
