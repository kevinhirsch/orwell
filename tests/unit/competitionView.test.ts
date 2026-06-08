import { describe, it, expect } from "vitest";
import { toPlayerCompetitionView } from "../../src/domain/competition";

// The player-facing competition projection (Vault-Wall rule: outcome only, never stats).
describe("toPlayerCompetitionView — outcome only, no stat leak", () => {
  it("renders a type + winner-label outcome", () => {
    const v = toPlayerCompetitionView({ type: "HOH", winnerLabel: "The new Head of Household" });
    expect(v.type).toBe("HOH");
    expect(v.outcome).toBe("The new Head of Household won the HOH competition.");
  });

  it("carries only { type, outcome } — there is no field a score could ride in on", () => {
    const v = toPlayerCompetitionView({ type: "veto", winnerLabel: "A houseguest" });
    expect(Object.keys(v).sort()).toEqual(["outcome", "type"]);
  });

  it("a numeric score passed as the label is still just a label — no stats semantics", () => {
    // Even if a caller mislabels, the projection has no stat/ranking field to populate.
    const v = toPlayerCompetitionView({ type: "endurance", winnerLabel: "The winner" });
    expect(v).not.toHaveProperty("score");
    expect(v).not.toHaveProperty("ranking");
    expect(v).not.toHaveProperty("stats");
  });
});
