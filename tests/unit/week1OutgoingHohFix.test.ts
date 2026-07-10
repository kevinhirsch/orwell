import { describe, it, expect } from "vitest";
import { BASE_GAME_MASTER_PROMPT } from "../../src/engine/momentPrompts";

/**
 * Issue #1321 — week-1 narration invents an "outgoing Head of Household"
 *
 * In week 1, the engine correctly has NO outgoing HOH and an EMPTY spectating list,
 * but the old prompt asserted the outgoing HOH unconditionally ("ALWAYS including the
 * outgoing HOH"), so the model fabricated one and named a houseguest.
 *
 * The fix: the whole-house-event guidance derives spectators from the `spectating`
 * list, ties the outgoing HOH to that list's non-empty case, and explicitly covers
 * the empty/first-HOH case — never inventing an outgoing HOH.
 *
 * These assertions pin the INVARIANTS, not exact phrasing (SOUL: pin the gate,
 * not the string) — reword freely as long as each behavior stays instructed.
 */
describe("#1321 — whole-house-event guidance handles empty spectating / week 1", () => {
  const prompt = BASE_GAME_MASTER_PROMPT;
  const lower = prompt.toLowerCase();

  it("no longer unconditionally asserts an outgoing HOH spectator", () => {
    expect(prompt).not.toContain("ALWAYS including the outgoing HOH");
  });

  it("ties the outgoing HOH to the spectating list rather than asserting the category", () => {
    // The outgoing-HOH mention must sit inside the spectating clause (within ~200 chars
    // of naming the list), framed as conditional on one existing.
    const tied = prompt.match(/spectating[\s\S]{0,200}outgoing HOH/i);
    expect(tied).toBeTruthy();
    // And the conditionality must be explicit.
    expect(/outgoing HOH (whenever|when|only if|if) one exists/i.test(prompt)).toBe(true);
  });

  it("explicitly covers the empty-spectating / first-HOH case: whole house competes, no outgoing HOH", () => {
    const emptyCase = prompt.match(/spectating[^.]{0,80}empty[\s\S]{0,220}/i);
    expect(emptyCase).toBeTruthy();
    const emptyClause = ((emptyCase && emptyCase[0].toLowerCase()) || "").replace(/\s+/g, " ");
    expect(emptyClause).toContain("whole house competes");
    expect(emptyClause).toContain("no outgoing hoh");
  });

  it("forbids inventing/naming an outgoing HOH when none exists", () => {
    expect(/never name or invent one/i.test(prompt)).toBe(true);
    expect(lower).toContain("first hoh");
  });
});
