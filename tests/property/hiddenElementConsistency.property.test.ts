import { describe, it, expect } from "vitest";
import {
  startNewGame, ARCHETYPES, CONCEALED_APTITUDES, HIDDEN_ELEMENT_GATES, HIDDEN_ELEMENT_RANGE,
} from "../../src/engine/characterFactory";

/**
 * Audit C9 — hidden elements are internally CONSISTENT, as a property over many seeded houses:
 *   - at most ONE secret-motive per NPC (a character has one secret agenda, not three),
 *   - every concealed aptitude is BACKED by the real hidden stat (no "hidden endurance machine"
 *     on a 0.45-physical floater) AND actually CONCEALED (the public archetype doesn't already
 *     advertise that stat — no "sharper at puzzles" on a public mastermind).
 * HARD rule: roles only — no names; generated houses are inspected structurally.
 */

const BIAS_OF = new Map(ARCHETYPES.map((a) => [a.archetype, a.bias]));
const APTITUDE_STAT = new Map(CONCEALED_APTITUDES.map((a) => [a.detail, a.stat]));

describe("C9 — hidden-element consistency holds across seeds", () => {
  it("one secret-motive max; every concealed aptitude is real and genuinely concealed; counts stay in range", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const house = startNewGame({ seed, playerName: "P" });
      for (const hg of house.npcs) {
        const els = hg.character.hiddenElements;
        expect(els.length).toBeGreaterThanOrEqual(HIDDEN_ELEMENT_RANGE.min);
        expect(els.length).toBeLessThanOrEqual(HIDDEN_ELEMENT_RANGE.max);

        const motives = els.filter((e) => e.kind === "secret-motive");
        expect(motives.length, `seed ${seed}: one secret agenda per character`).toBeLessThanOrEqual(
          HIDDEN_ELEMENT_GATES.maxSecretMotives,
        );

        const bias = BIAS_OF.get(hg.character.archetype)!;
        for (const e of els) {
          if (e.kind !== "concealed-aptitude") continue;
          const stat = APTITUDE_STAT.get(e.detail);
          expect(stat, `seed ${seed}: every concealed aptitude maps to a stat`).toBeTruthy();
          // Backable: the hidden stat genuinely clears the floor.
          expect(
            hg.character.stats[stat!],
            `seed ${seed}: "${e.detail}" must be backed by the real ${stat} stat`,
          ).toBeGreaterThanOrEqual(HIDDEN_ELEMENT_GATES.statFloor);
          // Concealed: the public archetype does not already advertise that strength.
          expect(
            bias[stat!],
            `seed ${seed}: a ${hg.character.archetype} already advertises ${stat} — nothing is concealed`,
          ).toBeLessThanOrEqual(HIDDEN_ELEMENT_GATES.publicBiasCeiling);
        }
      }
    }
  });

  it("concealed aptitudes still occur where they are earned (the gate prunes, it does not erase the kind)", () => {
    let aptitudes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const hg of startNewGame({ seed, playerName: "P" }).npcs) {
        aptitudes += hg.character.hiddenElements.filter((e) => e.kind === "concealed-aptitude").length;
      }
    }
    expect(aptitudes).toBeGreaterThan(0);
  });
});
