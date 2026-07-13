import { describe, it, expect } from "vitest";
import { resolveCompetition, CompetitionIntents, OUTCOME_WEIGHTS } from "../../src/domain/competitionOutcome";
import type { Competitor } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

/**
 * Feature 0127 — mixed-type (hybrid) competitions, the pure resolution half. A hybrid comp blends its
 * PRIMARY stat with a SECONDARY aptitude (a physical challenge with a puzzle element). Proves: the blend
 * rewards a well-rounded houseguest over a one-dimensional one; the primary stat still dominates; a
 * secondary equal to the primary is a no-op; and NO secondary ⇒ byte-identical to the pre-0127 single-stat
 * model. Roles only — no names.
 */

const W = OUTCOME_WEIGHTS;

/** Win rate of the FIRST competitor over `runs` seeds, pure vs blended. */
function winRate(field: () => Competitor[], secondary: "physical" | "mental" | "social" | undefined, runs = 400): number {
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveCompetition(field(), "physical", new CompetitionIntents(), new SeededRandom(i + 1), undefined, secondary);
    if (r.winner === npc(1)) wins++;
  }
  return wins / runs;
}

describe("0127 — a hybrid comp blends a secondary aptitude into the outcome", () => {
  it("a physical comp with a mental element favors the well-rounded houseguest over the one-dimensional one", () => {
    // npc(1): strong physical, ALSO strong mental (well-rounded). npc(2): equally strong physical, weak mental.
    const field = (): Competitor[] => [
      { id: npc(1), stats: { physical: 0.7, mental: 0.7, social: 0.5 } },
      { id: npc(2), stats: { physical: 0.7, mental: 0.3, social: 0.5 } },
    ];
    // On a PURE physical comp they are a coin flip (identical physical); with a mental element the
    // well-rounded one pulls clearly ahead.
    const pure = winRate(field, undefined);
    const hybrid = winRate(field, "mental");
    expect(pure).toBeGreaterThan(0.4);
    expect(pure).toBeLessThan(0.6);              // even physical ⇒ ~coin flip
    expect(hybrid).toBeGreaterThan(pure + 0.15); // the mental element tips it toward the all-rounder
  });

  it("the PRIMARY stat still dominates — a physical monster beats a mental-only player on a hybrid physical comp", () => {
    // npc(1): physical monster, mental weak. npc(2): physical weak, mental monster. On a physical-primary
    // hybrid (65% physical / 35% mental) the physical monster still wins the strong majority.
    const field = (): Competitor[] => [
      { id: npc(1), stats: { physical: 0.9, mental: 0.2, social: 0.5 } },
      { id: npc(2), stats: { physical: 0.2, mental: 0.9, social: 0.5 } },
    ];
    const hybrid = winRate(field, "mental");
    expect(hybrid).toBeGreaterThan(0.6); // primary dominates — the blend tilts, it does not invert
  });

  it("a secondary equal to the primary is a no-op (no self-blend)", () => {
    const field = (): Competitor[] => [
      { id: npc(1), stats: { physical: 0.7, mental: 0.4, social: 0.5 } },
      { id: npc(2), stats: { physical: 0.5, mental: 0.6, social: 0.5 } },
    ];
    expect(winRate(field, "physical")).toBe(winRate(field, undefined));
  });
});

describe("0127 — with no secondary the resolution is byte-identical to the pre-0127 model", () => {
  it("the winner, scores, and temperature map are identical with and without the (absent) secondary arg", () => {
    const field = (): Competitor[] => [
      { id: npc(1), stats: { physical: 0.6, mental: 0.55, social: 0.5 } },
      { id: npc(2), stats: { physical: 0.5, mental: 0.7, social: 0.4 } },
      { id: npc(3), stats: { physical: 0.45, mental: 0.5, social: 0.65 } },
    ];
    for (let i = 0; i < 50; i++) {
      const legacy = resolveCompetition(field(), "physical", new CompetitionIntents(), new SeededRandom(i + 1));
      const withArg = resolveCompetition(field(), "physical", new CompetitionIntents(), new SeededRandom(i + 1), undefined, undefined);
      expect(withArg.winner).toBe(legacy.winner);
      expect(withArg.scores).toEqual(legacy.scores);
      expect(withArg.temperature).toEqual(legacy.temperature);
    }
  });

  it("the blend weight is the tunable 0028 constant (primary keeps the majority share)", () => {
    expect(W.mixedSecondaryWeight).toBeGreaterThan(0);
    expect(W.mixedSecondaryWeight).toBeLessThan(0.5); // the primary stat keeps the majority share
  });
});
