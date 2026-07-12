import { describe, it, expect } from "vitest";
import {
  COMPETITION_THEMES, FORMAT_NOUN, themeForWeek, themedName, applyTheme,
} from "../../src/engine/competitionThemes";
import { COMPETITION_LIBRARY } from "../../src/engine/competitionLibrary";

/**
 * Feature 0125 — the competition THEME layer (pure engine half). A large seeded pool of Vault-free skins
 * over the 0042 mechanics so a season runs repeat-free. Proves: no theme repeats within a phase across a
 * season, it is seed-deterministic, the two phases diverge, the skin is coherent + Vault-free, and the
 * mechanic×theme space is deep enough for 100s of distinct comps. Roles only — no names.
 */

describe("0125 — the theme pool is deep enough for a repeat-free season", () => {
  it("mechanic × theme yields well over 100 distinct competitions", () => {
    // 6 mechanics/phase × 24 themes = 144 per phase — far more than an ~11-week season needs.
    expect(COMPETITION_THEMES.length).toBeGreaterThanOrEqual(20);
    const perPhase = COMPETITION_LIBRARY.filter((d) => d.phase === "hoh").length;
    expect(perPhase * COMPETITION_THEMES.length).toBeGreaterThan(100);
  });

  it("every theme has a distinct id and a non-empty label/prefix/setting", () => {
    expect(new Set(COMPETITION_THEMES.map((t) => t.id)).size).toBe(COMPETITION_THEMES.length);
    for (const t of COMPETITION_THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.prefix.length).toBeGreaterThan(0);
      expect(t.setting.length).toBeGreaterThan(0);
    }
  });
});

describe("0125 — the seeded draw never repeats a theme within a phase over a season", () => {
  it("an 11-week season of HOH themes is all distinct", () => {
    const seen = Array.from({ length: 11 }, (_, i) => themeForWeek(42, "hoh", i + 1).id);
    expect(new Set(seen).size).toBe(seen.length); // zero repeats across the whole season
  });

  it("the two phases diverge — same-week HOH and veto ALWAYS differ (a nonzero-rotation guarantee)", () => {
    // VETO rides the HOH permutation rotated by a nonzero offset, so a same-week theme can never
    // collide — verified exhaustively across many seeds × the full 24-week pool (not just a season).
    for (let seed = 0; seed < 400; seed++) {
      for (let w = 1; w <= COMPETITION_THEMES.length; w++) {
        expect(
          themeForWeek(seed, "hoh", w).id,
          `same-week HOH/veto theme collided at seed ${seed}, week ${w}`,
        ).not.toBe(themeForWeek(seed, "veto", w).id);
      }
    }
  });

  it("regression: seed 1 / week 10 no longer skins HOH and veto with the same theme", () => {
    // The confirmed pre-fix collision: independent per-phase permutations both placed "Film Noir" at
    // week 10 for seed 1, so a double-eviction week ran two identically-skinned comps.
    expect(themeForWeek(1, "hoh", 10).id).not.toBe(themeForWeek(1, "veto", 10).id);
  });

  it("a compressed twist cycle (double eviction) reskins the second same-phase comp of the SAME week", () => {
    // The second cycle of a double-eviction night reruns a same-phase comp under the same (seed, phase,
    // week); the cycle marker rotates it to a distinct theme so both crowns don't wear one skin.
    for (let seed = 0; seed < 400; seed++) {
      for (let w = 1; w <= COMPETITION_THEMES.length; w++) {
        for (const phase of ["hoh", "veto"] as const) {
          expect(
            themeForWeek(seed, phase, w, 0).id,
            `double-eviction ${phase} cycle collided at seed ${seed}, week ${w}`,
          ).not.toBe(themeForWeek(seed, phase, w, 1).id);
        }
      }
    }
  });

  it("cycle 0 is the default — the ordinary (non-twist) week is byte-identical to the bare call", () => {
    for (let seed = 0; seed < 50; seed++) {
      for (let w = 1; w <= COMPETITION_THEMES.length; w++) {
        expect(themeForWeek(seed, "hoh", w, 0).id).toBe(themeForWeek(seed, "hoh", w).id);
        expect(themeForWeek(seed, "veto", w, 0).id).toBe(themeForWeek(seed, "veto", w).id);
      }
    }
  });
});

describe("0125 — the draw is seed-deterministic", () => {
  it("the same seed reproduces the same theme sequence; a different seed shuffles it", () => {
    const a = Array.from({ length: 11 }, (_, i) => themeForWeek(7, "hoh", i + 1).id);
    const b = Array.from({ length: 11 }, (_, i) => themeForWeek(7, "hoh", i + 1).id);
    const c = Array.from({ length: 11 }, (_, i) => themeForWeek(8, "hoh", i + 1).id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c); // a different season shuffles the order
  });
});

describe("0125 — applyTheme is a coherent, Vault-free skin", () => {
  const endurance = COMPETITION_LIBRARY.find((d) => d.format === "endurance")!;

  it("the themed name is the theme prefix + the mechanic's format noun", () => {
    const theme = COMPETITION_THEMES[0]!;
    expect(themedName(endurance, theme)).toBe(`${theme.prefix} ${FORMAT_NOUN.endurance}`);
  });

  it("the premise weaves the theme setting AHEAD of the mechanic's own action; beats + winReads unchanged", () => {
    const theme = COMPETITION_THEMES.find((t) => t.id === "space")!;
    const skin = applyTheme(endurance, theme);
    expect(skin.narrative.premise.startsWith(theme.setting)).toBe(true);       // scene-setter first
    expect(skin.narrative.premise.includes(endurance.narrative.premise)).toBe(true); // then the real action (still coherent)
    expect(skin.narrative.beats).toEqual(endurance.narrative.beats);           // the mechanic's beats are untouched
    expect(skin.narrative.winReads).toBe(endurance.narrative.winReads);        // the aptitude read is untouched
    expect(skin.theme).toBe(theme.label);
  });

  it("no theme skin ever carries a stat, score, or number", () => {
    for (const def of COMPETITION_LIBRARY) {
      for (const theme of COMPETITION_THEMES) {
        const skin = applyTheme(def, theme);
        const blob = `${skin.name} ${skin.narrative.premise} ${skin.narrative.winReads} ${skin.theme}`;
        expect(/\d/.test(blob), `themed comp leaked a number: ${blob}`).toBe(false);
        expect(/physical|mental|social|trust|affinity|threat/i.test(`${skin.name} ${skin.theme}`)).toBe(false);
      }
    }
  });
});
