import { describe, it, expect } from "vitest";
import { BASE_GAME_MASTER_PROMPT, PREGAME_CASTING_BASE, buildSystemPrompt } from "../../src/engine/momentPrompts";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

/**
 * #1391 / #1395 — CASTING-FINALIZE REGRESSION GUARD.
 *
 * Two additions to the ALWAYS-ON base prompt are IN-GAME guidance that mis-fired during the PRE-GAME
 * casting interview and STALLED the model's drive to `createCharacter` (a real regression: with them
 * present a real-model record never drove casting to `ready`; without them it finalizes in ~4 turns):
 *   • #1391 — the TERMINAL HARD-RULES RECAP ("THE HARD LINE": 7 in-game "the game decides / WAIT / a
 *     new week does not exist / decision cards are hard stops" non-negotiables) sitting at MAXIMUM
 *     recency (the very tail of the base), which primes in-game passivity right where casting needs the
 *     model to actively collect answers and finalize; and
 *   • #1395 — the VOICE FINGERPRINT idiolect reword (the `catchphrases` PHRASINGS guidance), pure
 *     in-game noise pre-cast (no houseguest exists yet to voice).
 *
 * The fix makes both PHASE-AWARE: the `character-creation` (casting / pre-game) moment uses a base that
 * strips them and reverts to main's finalize-friendly shape; every IN-GAME moment keeps the full base.
 * This pins that gate so the regression cannot silently return. (The stronger "casting base is
 * byte-identical to main" claim is verified out-of-band at build time; here we pin behaviour without a
 * git dependency.)
 */

// Markers unique to each addition (NOT the bare word "catchphrases": the casting PRODUCER-VOICE section
// legitimately says "no catchphrases" in BOTH main and the branch — that is casting-appropriate and must
// stay; we target the #1395 idiolect GUIDANCE and the #1391 recap specifically).
const RECAP_MARKER = "THE HARD LINE"; // #1391 terminal recap (appears only in the recap block)
const IDIOLECT_MARKER = "PHRASINGS this exact person falls back on"; // #1395 in-game voice reword (unique)
const INGAME_VOICE_TAG = "VOICE FINGERPRINT (0084/0090/#1395)"; // the in-game voice-fingerprint bullet
const CASTING_VOICE_TAG = "VOICE FINGERPRINT (0084/0090):"; // main's (casting-safe) voice-fingerprint bullet

describe("#1391/#1395 — casting drops the in-game recap + idiolect reword (finalize regression guard)", () => {
  it("the IN-GAME base carries BOTH additions (they keep their intended benefit in play)", () => {
    expect(BASE_GAME_MASTER_PROMPT).toContain(RECAP_MARKER);
    expect(BASE_GAME_MASTER_PROMPT).toContain(IDIOLECT_MARKER);
    expect(BASE_GAME_MASTER_PROMPT).toContain(INGAME_VOICE_TAG);
  });

  it("the CASTING base carries NEITHER — it reverts to main's finalize-friendly shape", () => {
    expect(PREGAME_CASTING_BASE).not.toContain(RECAP_MARKER);
    expect(PREGAME_CASTING_BASE).not.toContain(IDIOLECT_MARKER);
    expect(PREGAME_CASTING_BASE).not.toContain(INGAME_VOICE_TAG);
    // and the casting-safe (main) voice-fingerprint bullet IS present in its place
    expect(PREGAME_CASTING_BASE).toContain(CASTING_VOICE_TAG);
  });

  it("the two bases share the spine verbatim and differ ONLY by the two additions", () => {
    // The casting base is strictly shorter, and everything up to the voice-fingerprint bullet (the first
    // divergence point) is byte-identical — proving the casting base is the SAME base minus exactly the
    // two in-game additions, not a separately-drifting copy.
    expect(PREGAME_CASTING_BASE.length).toBeLessThan(BASE_GAME_MASTER_PROMPT.length);
    const head = BASE_GAME_MASTER_PROMPT.indexOf("VOICE FINGERPRINT");
    expect(head).toBeGreaterThan(0);
    expect(PREGAME_CASTING_BASE.slice(0, head)).toBe(BASE_GAME_MASTER_PROMPT.slice(0, head));
  });

  it("buildSystemPrompt('character-creation') assembles from the casting base — no recap, no idiolect reword", () => {
    // Pre-createCharacter: the engine reports started=false and the moment is character-creation.
    const view = new GameSessionAdapter().getGameState();
    expect(view.started).toBe(false);
    expect(view.moment).toBe("character-creation");
    const prompt = buildSystemPrompt("character-creation", view);
    expect(prompt.startsWith(PREGAME_CASTING_BASE)).toBe(true);
    expect(prompt).not.toContain(RECAP_MARKER);
    expect(prompt).not.toContain(IDIOLECT_MARKER);
  });

  it("buildSystemPrompt(in-game moment) keeps the full base — recap + idiolect reword present", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 3 });
    const prompt = buildSystemPrompt("social", s.getGameState());
    expect(prompt.startsWith(BASE_GAME_MASTER_PROMPT)).toBe(true);
    expect(prompt).toContain(RECAP_MARKER);
    expect(prompt).toContain(IDIOLECT_MARKER);
  });
});
