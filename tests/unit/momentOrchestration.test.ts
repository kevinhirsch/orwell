import { describe, it, expect } from "vitest";
import {
  momentForPhase, momentFragment, buildSystemPrompt, renderGameContext,
  BASE_GAME_MASTER_PROMPT, MOMENT_PROMPTS,
} from "../../src/engine/momentPrompts";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

describe("0018 — narrative & moment orchestration", () => {
  it("maps phases to moments deterministically", () => {
    expect(momentForPhase("nominations")).toBe("nominations");
    expect(momentForPhase("HOH Competition")).toBe("hoh-competition");
    expect(momentForPhase("veto ceremony")).toBe("veto-ceremony");
    expect(momentForPhase("anything-else")).toBe("default");
    expect(momentForPhase("nominations")).toBe(momentForPhase("nominations"));
  });

  it("the base persona frames host/voice-of-house and forbids the generic-assistant break", () => {
    const p = BASE_GAME_MASTER_PROMPT;
    expect(p).toMatch(/host/i);
    expect(p).toMatch(/voice of every houseguest/i);
    expect(p).toMatch(/not a generic ai assistant/i);
  });

  it("the woven context is Vault-free (player card + phase + roster names; no stats/souls)", () => {
    const game = new GameSessionAdapter();
    game.createCharacter({ playerName: "Player One", seed: 4 });
    const ctx = renderGameContext(game.getGameState());
    expect(ctx).toContain("Player One");
    for (const banned of ["physical", "mental", "social", "soul", "volatility", "emotionalState"]) {
      expect(ctx.includes(banned)).toBe(false);
    }
  });

  it("editing a moment fragment changes only that moment", () => {
    const original = MOMENT_PROMPTS["social"]!;
    try {
      MOMENT_PROMPTS["social"] = "MOMENT — EDITED";
      expect(momentFragment("social")).toContain("EDITED");
      expect(momentFragment("nominations")).not.toContain("EDITED");
      expect(BASE_GAME_MASTER_PROMPT).toMatch(/host/i);
    } finally {
      MOMENT_PROMPTS["social"] = original;
    }
    expect(momentFragment("social")).toBe(original);
  });

  it("buildSystemPrompt is base + fragment + context (a pure read; mutates nothing)", () => {
    const game = new GameSessionAdapter();
    game.createCharacter({ playerName: "P", seed: 1 });
    const view = game.getGameState();
    const before = view.phase;
    const prompt = buildSystemPrompt("nominations", view);
    expect(prompt).toContain(MOMENT_PROMPTS["nominations"]!.slice(0, 20));
    expect(view.phase).toBe(before); // narration/prompt-building does not advance the game
  });
});
