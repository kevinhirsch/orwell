import type { EntityId } from "../domain/ids";
import type { WeekState } from "../domain/eligibility";
import { selectableReplacements } from "../domain/eligibility";

/**
 * The binding-decision seam (feature 0019). PURE: the engine surfaces the LEGAL
 * option set for a pending decision, and a binding choice changes state ONLY
 * through `executeDecision`, which re-validates against that set (defense in depth,
 * 0005). Prose never makes a binding decision — only this path does. Outcomes
 * themselves (who wins a comp, the tally) are decided elsewhere by the engine
 * (0006/0011/0014); this seam is about WHO chooses WHAT, legally.
 */
export type DecisionKind = "nominations" | "replacement" | "eviction-vote";

export interface DecisionContext {
  kind: DecisionKind | "none";
  /** For replacement / eviction-vote (carries hoh, nominees, vetoWinner, houseguests). */
  week?: WeekState;
  /** For nominations. */
  active?: EntityId[];
  hoh?: EntityId;
  /** Override the decider (defaults: HOH for noms/replacement, the player for their own vote). */
  by?: EntityId;
}

export interface PendingDecision {
  kind: DecisionKind;
  by: EntityId;
  options: EntityId[];
  /** How many entities the decider must pick. */
  pick: number;
}
export type PendingResult = PendingDecision | { kind: "none" };

/** The engine's LEGAL option set for the pending decision (0005/0011) — or none. */
export function pendingDecision(ctx: DecisionContext): PendingResult {
  switch (ctx.kind) {
    case "nominations": {
      const hoh = ctx.hoh!;
      return { kind: "nominations", by: hoh, options: ctx.active!.filter((h) => h !== hoh), pick: 2 };
    }
    case "replacement": {
      const w = ctx.week!;
      // selectableReplacements already excludes the HOH, the current nominees, AND the veto winner.
      return { kind: "replacement", by: w.hoh, options: selectableReplacements(w), pick: 1 };
    }
    case "eviction-vote": {
      const w = ctx.week!;
      return { kind: "eviction-vote", by: ctx.by ?? w.player, options: [w.nominees[0], w.nominees[1]], pick: 1 };
    }
    default:
      return { kind: "none" };
  }
}

export function isDecisionPending(ctx: DecisionContext): boolean {
  return pendingDecision(ctx).kind !== "none";
}

export interface DecisionResult {
  kind: DecisionKind;
  choice: EntityId[];
  recorded: true;
}

/**
 * Execute a binding choice — the ONLY way a decision changes state. Re-validates
 * the choice against the engine's legal set; throws (rejects) anything illegal,
 * ineligible, malformed, or made when nothing is pending.
 */
export function executeDecision(ctx: DecisionContext, choice: EntityId[]): DecisionResult {
  const pd = pendingDecision(ctx);
  if (pd.kind === "none") throw new Error("no decision is pending");
  if (!Array.isArray(choice) || choice.length !== pd.pick) throw new Error(`must choose exactly ${pd.pick}`);
  if (new Set(choice).size !== choice.length) throw new Error("a choice cannot repeat a houseguest");
  const legal = new Set(pd.options);
  for (const c of choice) if (!legal.has(c)) throw new Error(`illegal choice: ${c}`);
  return { kind: pd.kind, choice, recorded: true };
}
