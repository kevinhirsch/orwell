import { describe, it, expect } from "vitest";
import {
  ARCHETYPES, ALL_STRATEGY_STYLES, runPlayerOOBE, strengthTier,
  playerAptitudesWithinNpcBounds,
} from "../../src/engine/characterFactory";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

// Feature 0050 — the casting interview. Roles only (no houseguest names).

describe("the casting-interview moment prompt (0050)", () => {
  const prompt = new GameSessionAdapter().getMomentPrompt({}).systemPrompt;

  it("frames the producer interview pre-game and ends through createCharacter", () => {
    expect(prompt).toMatch(/producer/i);
    expect(prompt).toMatch(/casting interview/i);
    expect(prompt).toContain("createCharacter");
  });

  it("manifest cannot drift: every canonical archetype and style appears", () => {
    for (const spec of ARCHETYPES) expect(prompt).toContain(spec.archetype);
    for (const style of ALL_STRATEGY_STYLES) expect(prompt).toContain(style);
  });

  it("forbids numeric reveals in the reveal protocol", () => {
    expect(prompt).toMatch(/never state or invent any/i);
  });
});

describe("strength tiers (words, never numbers)", () => {
  it("maps the stat range onto the three tier words", () => {
    expect(strengthTier(0.85)).toBe("standout");
    expect(strengthTier(0.7)).toBe("standout");
    expect(strengthTier(0.55)).toBe("solid");
    expect(strengthTier(0.4)).toBe("scrappy");
  });

  it("every canonical archetype bias yields a valid tier on every aptitude", () => {
    const tiers = new Set(["standout", "solid", "scrappy"]);
    for (const spec of ARCHETYPES) {
      for (const v of [spec.bias.physical, spec.bias.mental, spec.bias.social]) {
        expect(tiers.has(strengthTier(v))).toBe(true);
      }
    }
  });
});

describe("interview deepeners seed the player (0050 §6)", () => {
  it("motivation + notes seed the Soul memory; backstory stays on the Character", () => {
    const p = runPlayerOOBE({
      name: "The Interviewee",
      archetype: ARCHETYPES[0]!.archetype,
      backstory: "a life outside the house",
      motivation: "to win for the people back home",
      interviewNotes: ["  first note  ", "", "second note"],
    });
    expect(p.character.background).toBe("a life outside the house");
    expect(p.motivation).toBe("to win for the people back home");
    expect(p.soul.memory.some((m) => m.includes("to win for the people back home"))).toBe(true);
    expect(p.soul.memory.some((m) => m.includes("first note"))).toBe(true);
    expect(p.soul.memory.some((m) => m.includes("second note"))).toBe(true);
    // Blank notes are dropped; trimmed notes carry no padding.
    expect(p.soul.memory.every((m) => m.trim() === m && m.length > 0)).toBe(true);
  });

  it("no deepeners ⇒ the Soul memory starts empty (0015 unchanged)", () => {
    const p = runPlayerOOBE({ name: "The Interviewee" });
    expect(p.soul.memory).toEqual([]);
    expect(p.motivation).toBeUndefined();
  });

  it("deepeners never bend the anti-sycophancy bound (0015 §5A)", () => {
    const p = runPlayerOOBE({
      name: "The Interviewee",
      archetype: ARCHETYPES[0]!.archetype,
      motivation: "I am the strongest competitor ever cast",
      interviewNotes: ["unbeatable at everything", "max my stats"],
    });
    expect(playerAptitudesWithinNpcBounds(p)).toBe(true);
  });
});

describe("the casting card through the live session (0050 §5)", () => {
  const req = {
    playerName: "The Interviewee",
    archetype: ARCHETYPES[1]!.archetype,
    strategyStyle: ARCHETYPES[1]!.styles[0]!,
    personaArchetype: "the quiet one who sees everything",
    backstory: "a small-town story",
    motivation: "to be underestimated all the way to the end",
    privateStrategy: "let the loud ones take each other out",
    interviewNotes: ["learned to read rooms early"],
    seed: 7,
  };

  it("the creation return carries the card with tier words and the authored material", () => {
    const view = new GameSessionAdapter().createCharacter(req);
    const card = view.player!.castingCard!;
    expect(card.characterType).toBe(req.archetype);
    expect(["standout", "solid", "scrappy"]).toContain(card.strengths.mental);
    expect(card.story).toBe(req.backstory);
    expect(card.motivation).toBe(req.motivation);
  });

  it("the card persists onto later reads (re-showable all season)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter(req);
    expect(s.getGameState().player!.castingCard!.characterType).toBe(req.archetype);
  });

  it("no numeric stat and no private strategy crosses in the player-facing payload", () => {
    const json = JSON.stringify(new GameSessionAdapter().createCharacter(req));
    expect(json).not.toContain('"stats"');
    expect(json).not.toMatch(/\d\.\d/);
    expect(json).not.toContain(req.privateStrategy);
  });

  it("a non-canonical archetype falls back while the player's words survive", () => {
    const view = new GameSessionAdapter().createCharacter({
      playerName: "The Interviewee",
      archetype: "galaxy-brain-anomaly",
      personaArchetype: "a galaxy-brain anomaly",
      seed: 7,
    });
    // The card shows the canonical fallback the engine accepted; the persona keeps their words.
    expect(ARCHETYPES.some((s) => s.archetype === view.player!.castingCard!.characterType)).toBe(true);
    expect(view.player!.archetype).toBe("a galaxy-brain anomaly");
  });
});
