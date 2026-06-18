import { describe, it, expect } from "vitest";
import { singlePickId } from "../../src/adapters/engine/decisionFields";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView } from "../../src/ports/GameSession";
import { npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Audit A10 — single-pick decisions (houseguests-choice / tie-break / final-eviction) must accept
 * the pick on the FE tool schema's documented `choice` field, not only the canonical `vote`.
 * HARD rule: roles only — no names.
 */
describe("A10 — singlePickId reads the pick from either `vote` or `choice`", () => {
  it("prefers `vote` when present", () => {
    expect(singlePickId({ vote: npc(3) })).toBe(npc(3));
    expect(singlePickId({ vote: npc(3), choice: [npc(9)] })).toBe(npc(3)); // vote wins the tie
  });

  it("accepts `choice` as a 1-element array (the schema's 'one houseguest id')", () => {
    expect(singlePickId({ choice: [npc(7)] })).toBe(npc(7));
  });

  it("accepts `choice` as a bare id (a non-FE client / loose JSON)", () => {
    expect(singlePickId({ choice: npc(4) as unknown as EntityId[] })).toBe(npc(4));
  });

  it("is undefined when neither field carries a pick", () => {
    expect(singlePickId({})).toBeUndefined();
    expect(singlePickId({ choice: [] })).toBeUndefined();
  });
});

describe("A10 — the live decision parser wires `choice` through to a real pending", () => {
  type Pending = NonNullable<AdvanceView["pending"]>;

  // Drive real seasons (player competes, to land in veto fields) until a houseguests-choice pending
  // appears, then resolve it via `choice` — proving submitDecision's parser accepts the documented
  // field end-to-end. Non-target pendings auto-resolve so the loop keeps moving.
  it("a houseguests-choice pending resolves when the pick rides on `choice`", () => {
    let proven = false;
    for (let seed = 1; seed <= 200 && !proven; seed++) {
      const session = new GameSessionAdapter();
      session.createCharacter({ playerName: "P", seed });
      for (let i = 0; i < 8000; i++) {
        const adv = session.advanceGame();
        const p: Pending | null = adv.pending;
        if (p?.kind === "houseguests-choice") {
          const fieldBefore = session.snapshot().live!.vetoField?.length ?? 0;
          // The pick rides on `choice` (a 1-element array), NEVER `vote`.
          session.submitDecision({ kind: "houseguests-choice", choice: [p.options[0]!.id] });
          const live = session.snapshot().live!;
          expect(live.vetoField).toContain(p.options[0]!.id);     // the pick completed the field…
          expect(live.vetoField!.length).toBe(fieldBefore + 1);    // …exactly one seat filled
          expect(live.pending?.kind).not.toBe("houseguests-choice"); // the decision was consumed
          proven = true;
          break;
        }
        if (p) {
          // Keep the season moving; the player competes so they keep reaching veto fields.
          switch (p.kind) {
            case "nominations": session.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] }); break;
            case "veto-decision": session.submitDecision({ kind: "veto-decision", use: false }); break;
            case "comp-intent": session.submitDecision({ kind: "comp-intent", intent: "compete" }); break;
            case "replacement": session.submitDecision({ kind: "replacement", replacement: p.options[0]!.id }); break;
            case "goodbye-message": session.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id, statement: "x" }); break;
            case "finale-statement": session.submitDecision({ kind: "finale-statement", statement: "x" }); break;
            case "finale-answer": session.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! }); break;
            case "juror-question": session.submitDecision({ kind: "juror-question", statement: "?" }); break;
            // tie-break / final-eviction / eviction-vote / juror-vote all take the pick the same way;
            // exercise `choice` for the single-pick kinds here too (free extra coverage).
            case "tie-break":
            case "final-eviction": session.submitDecision({ kind: p.kind, choice: [p.options[0]!.id] }); break;
            default: session.submitDecision({ kind: p.kind, vote: p.options[0]?.id }); break;
          }
        }
        if (adv.finished) break;
      }
    }
    expect(proven, "a houseguests-choice pending was reached and resolved via `choice`").toBe(true);
  });

  // D5-1: eviction-vote (the most-repeated weekly decision) and replacement missed the A10
  // standardization — they read `vote`/`replacement` directly and STALLED when a client sent the
  // documented `choice`. Prove both now resolve via `choice` (driving real seasons; the player
  // always USES the veto so a replacement pending is reached).
  it("eviction-vote and replacement pendings resolve when the pick rides on `choice`", () => {
    let evictionProven = false, replacementProven = false;
    for (let seed = 1; seed <= 200 && !(evictionProven && replacementProven); seed++) {
      const session = new GameSessionAdapter();
      session.createCharacter({ playerName: "P", seed });
      for (let i = 0; i < 8000; i++) {
        const adv = session.advanceGame();
        const p: Pending | null = adv.pending;
        if (p?.kind === "eviction-vote" && !evictionProven) {
          session.submitDecision({ kind: "eviction-vote", choice: [p.options[0]!.id] }); // pick via `choice`
          expect(session.snapshot().live!.pending?.kind).not.toBe("eviction-vote"); // consumed, not stalled
          evictionProven = true;
          continue;
        }
        if (p?.kind === "replacement" && !replacementProven) {
          session.submitDecision({ kind: "replacement", choice: [p.options[0]!.id] }); // pick via `choice`
          expect(session.snapshot().live!.pending?.kind).not.toBe("replacement");
          replacementProven = true;
          continue;
        }
        if (p) {
          switch (p.kind) {
            case "nominations": session.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] }); break;
            // ALWAYS use the veto when the player holds it, to reach a replacement pending.
            case "veto-decision": session.submitDecision(p.options[0]
              ? { kind: "veto-decision", use: true, save: p.options[0].id }
              : { kind: "veto-decision", use: false }); break;
            case "comp-intent": session.submitDecision({ kind: "comp-intent", intent: "compete" }); break;
            case "goodbye-message": session.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id, statement: "x" }); break;
            case "finale-statement": session.submitDecision({ kind: "finale-statement", statement: "x" }); break;
            case "finale-answer": session.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! }); break;
            case "juror-question": session.submitDecision({ kind: "juror-question", statement: "?" }); break;
            default: session.submitDecision({ kind: p.kind, choice: [p.options?.[0]?.id] } as never); break;
          }
        }
        if (adv.finished) break;
      }
    }
    expect(evictionProven, "an eviction-vote pending was reached and resolved via `choice`").toBe(true);
    expect(replacementProven, "a replacement pending was reached and resolved via `choice`").toBe(true);
  });
});
