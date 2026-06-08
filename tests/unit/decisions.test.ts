import { describe, it, expect } from "vitest";
import { pendingDecision, executeDecision, isDecisionPending } from "../../src/engine/decisions";
import { selectableReplacements } from "../../src/domain/eligibility";
import type { WeekState } from "../../src/domain/eligibility";
import { PLAYER, npc } from "../../src/domain/ids";

const HOUSE = [PLAYER, ...Array.from({ length: 15 }, (_, i) => npc(i + 1))];
const week = (over: Partial<WeekState>): WeekState =>
  ({ houseguests: HOUSE, player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)], ...over });

describe("0019 — the binding-decision seam", () => {
  it("none when nothing is pending", () => {
    expect(pendingDecision({ kind: "none" })).toEqual({ kind: "none" });
    expect(isDecisionPending({ kind: "none" })).toBe(false);
  });

  it("nominations: options are everyone but the HOH; pick 2", () => {
    const pd = pendingDecision({ kind: "nominations", hoh: PLAYER, active: HOUSE });
    expect(pd.kind).toBe("nominations");
    if (pd.kind !== "none") {
      expect(pd.pick).toBe(2);
      expect(pd.options.includes(PLAYER)).toBe(false);
    }
  });

  it("replacement: options equal the engine's legal set and exclude the veto winner", () => {
    const w = week({ vetoWinner: npc(4) });
    const pd = pendingDecision({ kind: "replacement", week: w });
    if (pd.kind === "none") throw new Error("expected pending");
    expect([...pd.options].sort()).toEqual([...selectableReplacements(w)].sort());
    expect(pd.options.includes(npc(4))).toBe(false);
  });

  it("executeDecision records a legal choice and rejects illegal/malformed ones", () => {
    const ctx = { kind: "replacement" as const, week: week({ vetoWinner: npc(4) }) };
    expect(executeDecision(ctx, [npc(5)]).recorded).toBe(true);
    expect(() => executeDecision(ctx, [npc(4)])).toThrow();      // the veto winner
    expect(() => executeDecision(ctx, [npc(1)])).toThrow();      // the HOH
    expect(() => executeDecision(ctx, [npc(5), npc(6)])).toThrow(); // wrong count
    expect(() => executeDecision({ kind: "none" }, [npc(5)])).toThrow();
  });

  it("eviction-vote: the voter picks one of the two nominees", () => {
    const ctx = { kind: "eviction-vote" as const, week: week({}), by: PLAYER };
    const pd = pendingDecision(ctx);
    if (pd.kind === "none") throw new Error("expected pending");
    expect([...pd.options].sort()).toEqual([npc(2), npc(3)].sort());
    expect(executeDecision(ctx, [npc(2)]).choice).toEqual([npc(2)]);
    expect(() => executeDecision(ctx, [npc(5)])).toThrow(); // not a nominee
  });
});
