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

  it("L28 — the base prompt pins DISTINCT registers: the house is NOT a room of identical warm pros", () => {
    const p = BASE_GAME_MASTER_PROMPT;
    // each houseguest is voiced in their OWN register, grounded in demeanor/archetype/background…
    expect(p).toMatch(/DISTINCT REGISTERS/);
    expect(p).toMatch(/own register/i);
    expect(p).toMatch(/demeanor/i);
    // …and the homogeneity it must break is named explicitly (a blunt one is blunt, a quiet one quiet)
    expect(p).toMatch(/not a room of identical/i);
    expect(p).toMatch(/a blunt houseguest is blunt/i);
    expect(p).toMatch(/a quiet one stays quiet/i);
  });

  it("L30 — the base prompt pins wander pacing: survey, then ONE cluster, then WAIT", () => {
    const p = BASE_GAME_MASTER_PROMPT;
    // one grouping at a time for real connection — the survey orients, the scene happens
    expect(p).toMatch(/ONE GROUPING AT A TIME/i);
    expect(p).toMatch(/brief orienting SURVEY/i);
    expect(p).toMatch(/WAIT for their reply/i);
    // it must NEVER narrate all rooms or fire multiple unanswerable questions in one turn
    expect(p).toMatch(/NEVER narrate all/i);
    expect(p).toMatch(/across\s+different rooms/i);
    // tied to the existing lingering / seize-the-lull framing
    expect(p).toMatch(/lingering IS play/i);
    expect(p).toMatch(/seize the lull/i);
  });

  it("L36 — the base prompt pins the OOC channel: meta/logistics queries are not voiced into the room", () => {
    const p = BASE_GAME_MASTER_PROMPT;
    // the two-channel distinction is named (talking to the game vs talking to the room)
    expect(p).toMatch(/TALKING TO THE GAME vs TALKING TO THE ROOM/i);
    // a bare logistics/state/time question is OUT OF CHARACTER — a HUD aside, not spoken aloud
    expect(p).toMatch(/OUT OF CHARACTER/);
    expect(p).toMatch(/producer\/HUD aside/i);
    // the house must NOT hear or react, and the scene continues uninterrupted (the L36 bug shape)
    expect(p).toMatch(/DO NOT make the house hear or react/i);
    expect(p).toMatch(/CONTINUES UNINTERRUPTED/i);
    // the explicit override marker is honored without exception
    expect(p).toMatch(/\(\(double parentheses\)\)/);
    expect(p).toMatch(/prefixed "ooc:"/i);
    // L36 follow-on: the model MARKS its own OOC answers (wrap in double-parens) so the surface can
    // render them as a producer/HUD aside, not a spoken-in-room line — the engine marker the FE needs.
    expect(p).toMatch(/MARK YOUR OWN OOC ANSWERS/i);
    expect(p).toMatch(/wrap your ENTIRE reply in \(\(double/i);
  });

  it("L40 — the base prompt restrains showmance over-labeling (no soap-opera saturation)", () => {
    const p = BASE_GAME_MASTER_PROMPT;
    expect(p).toMatch(/SHOWMANCES ARE RARE/i);
    // ordinary closeness is friendship/strategy, not romance, unless explicitly marked a romantic pair
    expect(p).toMatch(/do NOT read romance into ordinary closeness/i);
    expect(p).toMatch(/explicitly marks two people as a romantic pair/i);
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
