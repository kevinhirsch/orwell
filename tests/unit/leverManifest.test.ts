import { describe, it, expect } from "vitest";
import { BASE_GAME_MASTER_PROMPT, buildSystemPrompt } from "../../src/engine/momentPrompts";
import { PLAYER_AGENT_LEVERS } from "../../src/surfaces/tools/registry";
import type { GameStateView } from "../../src/ports/GameSession";

// Feature 0018 / B21 — the base prompt's lever manifest must name EVERY game-driving player lever,
// enforced so the prompt and the tool registry can never silently drift apart.
describe("lever manifest ↔ registry (0018 drift guard)", () => {
  it("names every game-driving player lever (none missing from the manifest)", () => {
    const missing = PLAYER_AGENT_LEVERS.filter((name) => !BASE_GAME_MASTER_PROMPT.includes(name));
    expect(missing, `levers absent from the base prompt manifest: ${missing.join(", ")}`).toEqual([]);
  });

  it("includes the live-loop and social levers added since the original four", () => {
    for (const lever of ["advanceGame", "submitDecision", "socialInitiatives", "diaryRoom"]) {
      expect(PLAYER_AGENT_LEVERS).toContain(lever);
      expect(BASE_GAME_MASTER_PROMPT).toContain(lever);
    }
  });

  it("states the engine decides outcomes and the model only voices them", () => {
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/engine\s+decides/i);
    expect(BASE_GAME_MASTER_PROMPT.toLowerCase()).toContain("never invent");
  });

  it("a competition moment directs resolving through the engine, no inventing/scores", () => {
    const view = { started: true, week: 1, phase: "hoh-competition", moment: "hoh-competition",
      player: { id: "p", name: "P", archetype: "a", strategyStyle: "s" }, house: [] } as unknown as GameStateView;
    const prompt = buildSystemPrompt("hoh-competition", view).toLowerCase();
    expect(prompt).toContain("runcompetition");
    expect(prompt).toMatch(/no scores|never (choose|reveal)|only the/);
  });
});
