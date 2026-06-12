import { describe, it, expect } from "vitest";
import { buildPortraitPrompt } from "../../src/engine/portraitPrompts";
import {
  STYLE_ANCHOR_VARIANTS,
  EXPRESSION_VARIANTS,
  FRAMING_VARIANTS,
  BACKDROP_VARIANTS,
} from "../../src/engine/imageConstants";
import { APPEARANCE_POOLS } from "../../src/engine/characterFactory";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

/**
 * G24 — portrait variety (anti-sameness / anti-AI-look). Three layers, one claim each:
 *   A. the season anchors ask for candid, imperfect production stills — never the
 *      AI-saturated "professional headshot / studio lighting" genre;
 *   B. expression/framing/backdrop vary PER SUBJECT (hash-seeded, stable per season)
 *      instead of every portrait sharing one identical pose/crop;
 *   C. the public appearance facets carry the axes that differentiate real faces
 *      (complexion, hair color+texture, distinguishing features, a wide age band).
 * HARD rule: roles only — generated fixtures, no real names.
 */

const facets = { appearance: "athletic, warm brown skin, loose chestnut curls, laugh lines, bright eyes", age: 31, presentation: "casual and laid-back" };

describe("G24/A — candid anchors, not AI-headshot anchors", () => {
  it("every anchor stays photorealistic and carries an imperfection cue", () => {
    for (const anchor of STYLE_ANCHOR_VARIANTS) {
      expect(anchor).toContain("photorealistic");
      expect(anchor).toMatch(/unretouched|true-to-life|lived-in|honest/);
    }
  });

  it("the AI-saturated headshot genre is ratcheted out of the anchors", () => {
    for (const anchor of STYLE_ANCHOR_VARIANTS) {
      expect(anchor).not.toMatch(/professional headshot|professional portrait|studio lighting/);
    }
  });
});

describe("G24/B — per-subject shot variation, deterministic per season", () => {
  const anchor = STYLE_ANCHOR_VARIANTS[0]!;

  it("the same (houseguest, anchor) always assembles the identical prompt", () => {
    const a = buildPortraitPrompt("hg:7", "A Houseguest", facets, anchor);
    const b = buildPortraitPrompt("hg:7", "A Houseguest", facets, anchor);
    expect(a.prompt).toBe(b.prompt);
  });

  it("every pick comes from the declared pools, and the anchor-first shape survives", () => {
    const p = buildPortraitPrompt("hg:3", "A Houseguest", facets, anchor).prompt;
    expect(p.startsWith(`${anchor}. Subject:`)).toBe(true);
    const expression = p.match(/Expression: ([^.]+)\./)?.[1];
    const framing = p.match(/Framing: ([^.]+)\./)?.[1];
    const setting = p.match(/Setting: (.+)$/)?.[1];
    expect(EXPRESSION_VARIANTS as readonly string[]).toContain(expression);
    expect(FRAMING_VARIANTS as readonly string[]).toContain(framing);
    expect(BACKDROP_VARIANTS as readonly string[]).toContain(setting);
  });

  it("a full cast does NOT share one pose: expressions, framings, and settings vary", () => {
    const adapter = new GameSessionAdapter();
    const view = adapter.createCharacter({ playerName: "The Player", seed: 1234 });
    const prompts = view.portraitPrompts!.map((p) => p.prompt);
    expect(prompts.length).toBeGreaterThanOrEqual(16);

    const pick = (re: RegExp) => new Set(prompts.map((p) => p.match(re)?.[1] ?? ""));
    // 16 subjects over pools of 10/8/8 — sameness would be 1 distinct value; require real spread.
    expect(pick(/Expression: ([^.]+)\./).size).toBeGreaterThanOrEqual(4);
    expect(pick(/Framing: ([^.]+)\./).size).toBeGreaterThanOrEqual(3);
    expect(pick(/Setting: (.+)$/).size).toBeGreaterThanOrEqual(3);
  });

  it("shot variation is season-keyed: a different anchor re-deals the shot", () => {
    // Not a hard guarantee per subject (hash collisions allowed) — but across a cast-sized
    // sweep the deals must differ somewhere, proving the anchor participates in the key.
    const other = STYLE_ANCHOR_VARIANTS[1]!;
    const ids = Array.from({ length: 16 }, (_, i) => `hg:${i}`);
    const dealt = (a: string) => ids.map((id) => buildPortraitPrompt(id, "A Houseguest", facets, a).prompt.split("Expression:")[1]).join("|");
    expect(dealt(anchor)).not.toBe(dealt(other));
  });
});

describe("G24/C — appearance facets carry the differentiating axes", () => {
  it("every cast member's appearance includes a complexion and a distinguishing feature", () => {
    const adapter = new GameSessionAdapter();
    const view = adapter.createCharacter({ playerName: "The Player", seed: 99 });
    const cards = view.house as ReadonlyArray<{ appearance?: string; age?: number }>;
    expect(cards.length).toBe(15);
    for (const hg of cards) {
      expect(hg.appearance).toBeTruthy();
      expect(APPEARANCE_POOLS.COMPLEXIONS.some((c) => hg.appearance!.includes(c))).toBe(true);
      expect(APPEARANCE_POOLS.FEATURES.some((f) => hg.appearance!.includes(f))).toBe(true);
      expect(APPEARANCE_POOLS.HAIR.some((h) => hg.appearance!.includes(h))).toBe(true);
    }
  });

  it("ages span the widened 21–52 band", () => {
    const adapter = new GameSessionAdapter();
    const view = adapter.createCharacter({ playerName: "The Player", seed: 7 });
    for (const hg of view.house as ReadonlyArray<{ age?: number }>) {
      expect(hg.age).toBeGreaterThanOrEqual(21);
      expect(hg.age).toBeLessThanOrEqual(52);
    }
  });

  it("a cast reads as distinct people: appearance strings barely collide", () => {
    const adapter = new GameSessionAdapter();
    const view = adapter.createCharacter({ playerName: "The Player", seed: 4242 });
    const appearances = (view.house as ReadonlyArray<{ appearance?: string }>).map((h) => h.appearance);
    expect(new Set(appearances).size).toBeGreaterThanOrEqual(13);
  });

  it("facets stay seed-stable: the same seed deals the same faces", () => {
    const deal = (seed: number) => {
      const a = new GameSessionAdapter();
      const v = a.createCharacter({ playerName: "The Player", seed });
      return (v.house as ReadonlyArray<{ appearance?: string; age?: number }>).map((h) => `${h.appearance}|${h.age}`).join("~");
    };
    expect(deal(555)).toBe(deal(555));
  });

  it("no facet smuggles hidden-layer vocabulary", () => {
    for (const pool of Object.values(APPEARANCE_POOLS)) {
      for (const entry of pool) {
        expect(entry).not.toMatch(/\b(trust|affinity|threat|soul|confessional|secret-motive|stat)\b/i);
      }
    }
  });
});
