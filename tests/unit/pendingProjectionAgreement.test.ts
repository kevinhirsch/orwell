import { describe, expect, it } from "vitest";
import { composeRuntime } from "../../src/composition/runtime";

/**
 * M0-7 — the pending-projection agreement gate. Two Vault-free closed-set projections of
 * one sandbox (`getGameState` and `gameStatus`) must never disagree about the live pending
 * decision: the eviction-vote ballot used to surface only on gameStatus while
 * getGameState.pending read null, and any consumer keying on state inherited the gap
 * silently (the golden driver absorbed 25 escalated turns on exactly this). The walk below
 * advances a seeded season through a full week, answering every player pending with a
 * fixed legal policy, and asserts the two projections agree at EVERY step.
 *
 * Roles only — decisions key on option POSITIONS, never names.
 */


function decisionFor(p: any): Record<string, unknown> | null {
  const o = p.options ?? [];
  const oid = (i: number) => (o.length > i ? o[i].id : undefined);
  switch (p.kind) {
    case "nominations": return { kind: p.kind, choice: [oid(0), oid(1)] };
    case "veto-decision": return { kind: p.kind, use: false };
    case "comp-intent": return { kind: p.kind, intent: "compete" };
    case "comp-round": return { kind: p.kind, intent: "compete" };
    case "houseguests-choice": return { kind: p.kind, vote: oid(0) };
    case "replacement": return { kind: p.kind, replacement: oid(0) };
    case "eviction-vote": return { kind: p.kind, vote: oid(0) };
    case "tie-break": return { kind: p.kind, vote: oid(0) };
    case "goodbye-message": return { kind: p.kind, vote: oid(0), statement: "Play hard out there." };
    default: return null;
  }
}

describe("pending projection agreement (M0-7)", () => {
  it("getGameState.pending === gameStatus.pending at every beat of a seeded week", async () => {
    const runtime = composeRuntime();
    {
      const tools = runtime.registry.resolver()("player", "agree");
      await tools.callTool("createCharacter", { playerName: "P", seed: 424242 });
      let weekRolled = false;
      for (let step = 0; step < 200 && !weekRolled; step++) {
        const state: any = await tools.callTool("getGameState", {});
        const status: any = await tools.callTool("gameStatus", {});
        expect(JSON.stringify(state.pending ?? null)).toBe(JSON.stringify(status.pending ?? null));
        const pending = status.pending;
        if (pending && pending.kind) {
          const body = decisionFor(pending);
          expect(body, `no fixed policy for pending kind ${pending.kind}`).not.toBeNull();
          await tools.callTool("submitDecision", body!);
        } else {
          const adv: any = await tools.callTool("advanceGame", {});
          // The advance's own view must agree with the read projections too.
          const after: any = await tools.callTool("getGameState", {});
          expect(JSON.stringify(after.pending ?? null)).toBe(JSON.stringify((adv.pending ?? null)));
          if ((after.week ?? 1) >= 2) weekRolled = true;
        }
      }
      expect(weekRolled).toBe(true);
    }
  }, 120_000);
});
