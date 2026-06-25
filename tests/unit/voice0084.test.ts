import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  generateVoice, moodWord, VOICE_DIALS, type VoiceProfile,
} from "../../src/engine/voice";

/**
 * Feature 0084 — the pure VOICE fingerprint + grounded MOOD word. Roles only; seeded + deterministic.
 * Voice is distinct-by-construction and byte-stable; mood tracks the live soul on two timescales
 * (acute spike + marinated baseline) and never emits a number or the hidden cause.
 */

const ARCHETYPES = [
  "comp-beast", "mastermind", "social-butterfly", "floater",
  "villain", "underdog", "flirt", "loyalist",
];

function castVoices(seed: number, n = 15): VoiceProfile[] {
  const rng = new SeededRandom(seed);
  return Array.from({ length: n }, (_, i) => generateVoice(rng, ARCHETYPES[i % ARCHETYPES.length]!));
}

describe("0084 voice — distinct, complete, deterministic", () => {
  it("every generated voice is complete (all dials + a signature + 1–2 fillers)", () => {
    for (const v of castVoices(7)) {
      expect(VOICE_DIALS.register).toContain(v.register);
      expect(VOICE_DIALS.rhythm).toContain(v.rhythm);
      expect(VOICE_DIALS.energy).toContain(v.energy);
      expect(VOICE_DIALS.directness).toContain(v.directness);
      expect(VOICE_DIALS.humor).toContain(v.humor);
      expect(VOICE_DIALS.stressTell).toContain(v.stressTell);
      expect(v.signature.length).toBeGreaterThan(0);
      expect(v.lexicon.length).toBeGreaterThanOrEqual(1);
      expect(v.lexicon.length).toBeLessThanOrEqual(2);
    }
  });

  it("the cast does not share one voice — distinct fingerprints, spanning a range", () => {
    for (const seed of [1, 7, 42, 99]) {
      const cast = castVoices(seed);
      const prints = cast.map((v) => JSON.stringify(v));
      expect(new Set(prints).size).toBe(cast.length); // no two identical
      // Spread, not homogeneity: the cast spans several registers and rhythms.
      expect(new Set(cast.map((v) => v.register)).size).toBeGreaterThanOrEqual(3);
      expect(new Set(cast.map((v) => v.rhythm)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it("is deterministic — same seed, same voices", () => {
    expect(castVoices(123)).toEqual(castVoices(123));
  });

  it("archetype leans the voice without collapsing it (comp-beast skews blunt)", () => {
    let blunt = 0;
    const N = 200;
    for (let i = 0; i < N; i++) blunt += generateVoice(new SeededRandom(i), "comp-beast").directness === "blunt" ? 1 : 0;
    expect(blunt / N).toBeGreaterThan(0.5); // leans blunt
    expect(blunt / N).toBeLessThan(1); // but not every one — still varied
  });
});

describe("0084 mood — grounded in the soul, two timescales, Vault-safe", () => {
  it("a low acute state reads as distress, not a pleasant default", () => {
    const m = moodWord(0.12, 0.5, [0.5, 0.4, 0.3, 0.12]);
    expect(m).toMatch(/shaken|worn|hollow|subdued/);
    expect(m).not.toMatch(/ease|riding high/);
  });

  it("marinates — a worn-down history reads worn even on a calm current moment", () => {
    // History dragged low over the season; the current moment is neutral-calm (no acute spike).
    const worn = moodWord(0.46, 0.5, [0.3, 0.25, 0.2, 0.22, 0.18, 0.24]);
    expect(worn).toMatch(/worn|hollow|subdued/);
    expect(worn).not.toBe("even");
    // A long SAFE run reads as lasting ease in the same calm moment.
    const easy = moodWord(0.54, 0.5, [0.7, 0.75, 0.8, 0.78, 0.82, 0.76]);
    expect(easy).toMatch(/ease|riding high/);
  });

  it("acute spike/crash overrides the baseline; mean-reversion returns the word", () => {
    const baseline = [0.5, 0.5, 0.5];
    const calm = moodWord(0.5, 0.4, baseline);
    const crashed = moodWord(0.18, 0.4, baseline); // a costly beat just landed
    expect(crashed).not.toBe(calm);
    expect(crashed).toMatch(/shaken|rattled/);
    expect(moodWord(0.5, 0.4, baseline)).toBe(calm); // settles back as the soul mean-reverts
  });

  it("high volatility adds an on-edge qualifier", () => {
    expect(moodWord(0.5, 0.85, [0.5])).toMatch(/on edge/);
    expect(moodWord(0.5, 0.3, [0.5])).not.toMatch(/on edge/);
  });

  it("never emits a number (Vault-safe affect word only)", () => {
    for (const e of [0.0, 0.2, 0.5, 0.8, 1.0]) {
      for (const v of [0.1, 0.5, 0.9]) {
        expect(moodWord(e, v, [e])).not.toMatch(/[0-9]/);
      }
    }
  });

  it("is deterministic and handles an empty history (fresh soul)", () => {
    expect(moodWord(0.5, 0.5)).toBe(moodWord(0.5, 0.5));
    expect(moodWord(0.5, 0.5)).toBe("even");
  });
});
