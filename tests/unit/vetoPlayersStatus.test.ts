import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView } from "../../src/ports/GameSession";

/**
 * C-03 (found in live play): the GM invented the veto FIELD ("who plays") because nothing grounded
 * the deterministic chip draw. Fix: gameStatus exposes `veto.players` — the witnessed drawn six —
 * empty before the chips come out and the full named field once drawn, so the narrator voices the
 * real players (parallels the nominee grounding). Public ceremony fact only. HARD rule: roles only.
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

describe("C-03 — gameStatus grounds the drawn veto field", () => {
  it("is empty before the chip draw and exposes the full named field once drawn", () => {
    let sawEmptyBeforeDraw = false, sawDrawnField = false, sawHolderInField = false;
    for (let seed = 1; seed <= 6 && !(sawEmptyBeforeDraw && sawDrawnField && sawHolderInField); seed++) {
      const s = new GameSessionAdapter();
      s.createCharacter({ playerName: "P", seed });
      for (let i = 0; i < 200; i++) {
        const st = s.gameStatus();
        const players = st.veto.players;
        // The field is NEVER a raw id and never larger than the legal six (E35).
        for (const pl of players) {
          expect(pl.name && pl.name.length).toBeTruthy();
          expect(pl.name).not.toMatch(/^(npc:|player$)/);
        }
        expect(players.length).toBeLessThanOrEqual(6);

        if (st.phase === "veto-competition" && players.length === 0) sawEmptyBeforeDraw = true;
        if (players.length > 0) {
          const ids = new Set(players.map((pl) => pl.id));
          sawDrawnField = true;
          // At the veto comp the field carries the CURRENT nominees (they always play the veto). After
          // the ceremony a replacement may go up who never played, so only assert this pre-ceremony.
          if (st.phase === "veto-competition") {
            for (const nom of st.nominees) expect(ids.has(nom.id)).toBe(true);
          }
          // Once the comp is crowned (the holder appears, at the veto ceremony), the holder is in it.
          if (st.veto.holder) { expect(ids.has(st.veto.holder.id)).toBe(true); sawHolderInField = true; }
        }

        const adv = s.advanceGame();
        if (adv.pending) resolve(s, adv.pending);
        if (adv.finished) break;
      }
    }
    expect(sawEmptyBeforeDraw, "veto.players was empty before the chip draw").toBe(true);
    expect(sawDrawnField, "veto.players exposed the drawn field carrying the nominees").toBe(true);
    expect(sawHolderInField, "the crowned veto holder is a member of the drawn field").toBe(true);
  });

  it("clears the drawn field when the week rolls into the next HOH", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 4 });
    let sawDrawn = false;
    let weekOfDraw = 0;
    for (let i = 0; i < 200; i++) {
      const st = s.gameStatus();
      if (st.veto.players.length > 0) { sawDrawn = true; weekOfDraw = st.week; }
      // A later week with no veto run yet must report an empty field, never last week's stale six.
      if (sawDrawn && st.week > weekOfDraw && st.phase === "hoh-competition") {
        expect(st.veto.players).toEqual([]);
        break;
      }
      const adv = s.advanceGame();
      if (adv.pending) resolve(s, adv.pending);
      if (adv.finished) break;
    }
    expect(sawDrawn, "a veto field was drawn during the run").toBe(true);
  });
});
