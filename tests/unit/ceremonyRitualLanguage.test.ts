import { describe, it, expect } from "vitest";
import { MOMENT_PROMPTS } from "../../src/engine/momentPrompts";

/**
 * BB-nerd audit (2026-07-03, lanes bb-nerd.md/microcopy.md/endgame.md) — the ceremonies read
 * mechanically correct but lack the show's own ritual language: the nomination ceremony's
 * "I've nominated you, and you, for eviction… this is purely strategic," the veto ceremony's
 * "do you wish to use the Power of Veto?" / "this veto meeting is adjourned," the eviction
 * reveal's "by a vote of…"/goodbye countdown, and the finale's crowning cadence.
 *
 * This is PROMPT-TEXT ONLY (mandate/ADR 0003 — facts to voice, never a script to recite): the
 * fragments below instruct the model to hit the show's cadence using the GAME's own names/tallies,
 * never a hard-coded houseguest. Pinning the cue PHRASES here (not full sentences) so the prose can
 * still be edited/refined without becoming a brittle golden-string test. Roles only — no fixture
 * names, and no legacy Game Bible names appear anywhere below.
 */
describe("ceremony moment-prompt fragments carry the show's ritual-language cues (BB-nerd audit)", () => {
  it("nominations: cues the key ceremony + the canonical nomination phrasing + the strategic-not-personal beat", () => {
    const p = MOMENT_PROMPTS.nominations;
    expect(p).toMatch(/turns a key for each safe houseguest|the key turns/i);
    expect(p).toContain("I've nominated you, and you, for eviction");
    expect(p).toMatch(/purely strategic/i);
    expect(p).toMatch(/nothing personal/i);
    // Framing, not a script: the model is told to use its OWN words / the game's real names.
    expect(p).toMatch(/own words|not a copy of anyone else's/i);
  });

  it("veto-competition: still cues the chip-draw ritual (pre-existing, unchanged)", () => {
    const p = MOMENT_PROMPTS["veto-competition"];
    expect(p).toMatch(/RITUAL BEAT/i);
    expect(p).toMatch(/Houseguest's Choice/);
  });

  it("veto-ceremony: cues the veto-meeting ritual grammar (the show's thinnest ceremony, BB-18)", () => {
    const p = MOMENT_PROMPTS["veto-ceremony"];
    expect(p).toMatch(/do you wish to use the Power of Veto\?/i);
    expect(p).toMatch(/I have decided to use the Power of Veto/i);
    expect(p).toMatch(/I have decided NOT to use the Power of Veto/i);
    expect(p).toMatch(/this veto meeting is adjourned/i);
    // The replacement is grounded in engine truth, never invented.
    expect(p).toMatch(/ONLY from the game's recorded pick|never invent or guess/i);
  });

  it("eviction: cues the 'by a vote of…' crowning-of-the-reveal cadence + the goodbye countdown", () => {
    const p = MOMENT_PROMPTS.eviction;
    expect(p).toMatch(/by a vote of/i);
    expect(p).toMatch(/you are evicted from the Big Brother house/i);
    expect(p).toMatch(/seconds to say your goodbyes/i);
    // Grounded in the actual tally read out this turn, never invented.
    expect(p).toMatch(/ONLY the tally you actually read out/i);
  });

  it("jury-finale: cues the crowning cadence, grounded in the game's real tally", () => {
    const p = MOMENT_PROMPTS["jury-finale"];
    expect(p).toMatch(/by a vote of/i);
    expect(p).toMatch(/you are the winner of Big Brother/i);
    expect(p).toMatch(/never a number you have not tallied yourself/i);
  });

  it("no ceremony fragment hard-codes a specific houseguest name — only role/placeholder language", () => {
    const banned = [
      "Jada", "Marin", "Diego", "Salinas", "Shea", "O'Malley", "Klaus", "Maeve",
      "Lorenzo", "Mila", "Kowalski", "Gina", "Ricci", "Tanner", "Huff", "Regina", "Manning",
      "Caleb", "Myra", "Trujillo", "Irene", "Shaffer",
    ];
    for (const key of ["nominations", "veto-competition", "veto-ceremony", "eviction", "jury-finale"]) {
      const p = MOMENT_PROMPTS[key];
      for (const name of banned) {
        expect(p, `${key} must not hard-code the name "${name}"`).not.toContain(name);
      }
    }
  });
});
