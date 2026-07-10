import { describe, it, expect } from "vitest";
import { BASE_GAME_MASTER_PROMPT } from "../../src/engine/momentPrompts";

/**
 * Issue #1321 — week-1 narration invents an "outgoing Head of Household"
 *
 * In week 1, the engine correctly has NO outgoing HOH and an EMPTY spectating list,
 * but the old prompt asserted the outgoing HOH unconditionally, so the model fabricated one.
 *
 * The fix: make the whole-house-event guidance conditional on the `spectating` list.
 * When `spectating` is not empty, it includes the outgoing HOH. When empty (week 1),
 * the whole house competes and there is no outgoing HOH — never invent one.
 */
describe("#1321 — whole-house-event guidance handles empty spectating / week 1", () => {
  const basePrompt = BASE_GAME_MASTER_PROMPT;

  it("the base prompt no longer unconditionally asserts an outgoing HOH in competitions", () => {
    // The old problem: "ALWAYS including the outgoing HOH"
    expect(basePrompt).not.toContain("ALWAYS including the outgoing HOH");
  });

  it("the whole-house-event guidance explicitly makes the outgoing HOH conditional on spectating", () => {
    // The fix must instruct the model to derive spectators from the `spectating` list,
    // not invent an outgoing HOH.
    expect(basePrompt.toLowerCase()).toContain("spectating");
    expect(basePrompt.toLowerCase()).toContain("when empty");
    expect(basePrompt.toLowerCase()).toContain("whole house competes");
  });

  it("the guidance explicitly addresses the week-1 case where spectating is empty", () => {
    // Week 1: no outgoing HOH, empty spectating list, entire house competes.
    expect(basePrompt.toLowerCase()).toContain("when empty");
    expect(basePrompt.toLowerCase()).toContain("no outgoing hoh");
  });

  it("the guidance frames the outgoing HOH as present only when spectating is not empty", () => {
    // The model must understand the outgoing HOH exists only when there's a previous week.
    expect(basePrompt.toLowerCase()).toContain("when not empty");
    expect(basePrompt).toContain("outgoing HOH");
    // The outgoing HOH must be paired with the conditional, not asserted unconditionally.
    const conditionalMatch = basePrompt.match(
      /when\s+(?:not\s+)?empty[\s\S]{0,150}outgoing\s+HOH/i
    );
    expect(conditionalMatch).toBeTruthy();
  });
});
