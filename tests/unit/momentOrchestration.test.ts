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

  it("L25 — the base prompt pins the casting interview OOC: no NPC knows a casting answer until revealed in-scene", () => {
    const p = BASE_GAME_MASTER_PROMPT;
    // The casting interview is producer-only, with no pathway into the house (mirrors the Diary Room).
    expect(p).toMatch(/casting interview is sealed from the house/i);
    expect(p).toMatch(/no houseguest ever learns/i);
    // The exact L25 leak shape — an NPC quoting the player's profession back as a "read" — is named.
    expect(p).toMatch(/never quote, paraphrase, or even allude to a casting answer/i);
    expect(p).toMatch(/witnessed/i); // NPCs form their read from witnessed behavior only
  });

  it("the woven context is Vault-free (player card + phase + roster names; no stats/souls)", () => {
    const game = new GameSessionAdapter();
    game.createCharacter({ playerName: "Player One", seed: 4 });
    const ctx = renderGameContext(game.getGameState());
    expect(ctx).toContain("Player One");
    // The woven context is PROSE, not the stat block: bare "physical"/"mental"/"social" are public
    // words (a "physical therapist" vocation, a "social" strategy style — L28), so they are NOT
    // banned. The hidden layer is banned precisely (soul vocabulary), and no numeric aptitude (a
    // float) may ever ride along — that is what a real stat leak would look like in the context.
    for (const banned of ['"soul"', "volatility", "emotionalState", "hiddenElement", "secret-motive"]) {
      expect(ctx.includes(banned)).toBe(false);
    }
    expect(ctx).not.toMatch(/\d\.\d/);
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
