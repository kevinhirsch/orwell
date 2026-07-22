import { describe, it, expect } from "vitest";
import {
  genCompetitionsEnvDefault,
  GEN_COMPETITION_BOUNDS,
  GEN_COMPETITIONS_ENV,
  GEN_COMPETITION_MODEL_CLASS,
  GEN_COMPETITION_CALLS_PER_COMP,
} from "../../src/engine/genCompetitionConstants";

const ENV_KEY = "ORWELL_GEN_COMPETITIONS";

describe("G13 — genCompetitionConstants: env-default + sanitization bounds", () => {
  describe("genCompetitionsEnvDefault", () => {
    it.each([
      // falsy: unset, empty, whitespace
      [{}, false],
      [{ [ENV_KEY]: "" }, false],
      [{ [ENV_KEY]: "   " }, false],
      // truthy: standard truthy values
      [{ [ENV_KEY]: "1" }, true],
      [{ [ENV_KEY]: "true" }, true],
      [{ [ENV_KEY]: "on" }, true],
      [{ [ENV_KEY]: "yes" }, true],
      // case / whitespace tolerance (trim + lowercase)
      [{ [ENV_KEY]: " TRUE " }, true],
      [{ [ENV_KEY]: "On" }, true],
      [{ [ENV_KEY]: "YES" }, true],
      [{ [ENV_KEY]: " 1 " }, true],
      // falsy: explicit off / false / unknown
      [{ [ENV_KEY]: "0" }, false],
      [{ [ENV_KEY]: "false" }, false],
      [{ [ENV_KEY]: "off" }, false],
      [{ [ENV_KEY]: "no" }, false],
      [{ [ENV_KEY]: "2" }, false],
      [{ [ENV_KEY]: "enabled" }, false],
      [{ [ENV_KEY]: "y" }, false],
      [{ [ENV_KEY]: "garbage" }, false],
    ])("env=%o => %s", (env, expected) => {
      expect(genCompetitionsEnvDefault(env)).toBe(expected);
    });
  });

  describe("GEN_COMPETITION_BOUNDS — exact caps (catching accidental changes)", () => {
    it("maxThemeLen === 120", () => {
      expect(GEN_COMPETITION_BOUNDS.maxThemeLen).toBe(120);
    });
    it("maxPremiseLen === 600", () => {
      expect(GEN_COMPETITION_BOUNDS.maxPremiseLen).toBe(600);
    });
    it("maxWinReadsLen === 240", () => {
      expect(GEN_COMPETITION_BOUNDS.maxWinReadsLen).toBe(240);
    });
    it("maxFictionLen === 300", () => {
      expect(GEN_COMPETITION_BOUNDS.maxFictionLen).toBe(300);
    });
  });

  describe("module constants", () => {
    it("GEN_COMPETITIONS_ENV === 'ORWELL_GEN_COMPETITIONS'", () => {
      expect(GEN_COMPETITIONS_ENV).toBe("ORWELL_GEN_COMPETITIONS");
    });
    it("GEN_COMPETITION_MODEL_CLASS === 'utility'", () => {
      expect(GEN_COMPETITION_MODEL_CLASS).toBe("utility");
    });
    it("GEN_COMPETITION_CALLS_PER_COMP === 1", () => {
      expect(GEN_COMPETITION_CALLS_PER_COMP).toBe(1);
    });
  });
});
