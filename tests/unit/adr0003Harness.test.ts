import { describe, it, expect } from "vitest";
import {
  adrFixture, presenceCoherenceViolations, knowledgeScopeViolations,
  personaDriftViolations, lingeringViolations,
} from "../support/adr0003";

/**
 * B66 — the ADR-0003 testability harness: the conversation-is-the-game principles enforced as
 * STRUCTURAL invariants over the production object graph, via the reusable helpers in
 * `tests/support/adr0003.ts`. If presence / knowledge-scope / persona-stability / lingering
 * regress anywhere in the engine, THIS suite fails and names the violation. Roles only.
 */
describe("ADR 0003 — the structural principles, as one reusable harness (B66)", () => {
  it("§8 presence coherence: one room each, adjacency-only movement, across seeded ticks", () => {
    for (const seed of [3, 11]) {
      const fixture = adrFixture(`adr-presence-${seed}`, seed);
      expect(presenceCoherenceViolations(fixture, `adr-presence-${seed}`, 10)).toEqual([]);
    }
  });

  it("§8 knowledge-scoped speech: every NPC voices their own knowledge and no one else's", () => {
    const fixture = adrFixture("adr-scope", 5);
    expect(knowledgeScopeViolations(fixture.sb)).toEqual([]);
  });

  it("§8 persona stability: the narrator's facets are byte-identical across turns", () => {
    const fixture = adrFixture("adr-persona", 7);
    expect(personaDriftViolations(fixture.sb, 25)).toEqual([]);
  });

  it("§7 lingering safety: mill/talk turns never move the week and count as activity", () => {
    const fixture = adrFixture("adr-linger", 9);
    expect(lingeringViolations(fixture, "adr-linger", 12)).toEqual([]);
  });
});
