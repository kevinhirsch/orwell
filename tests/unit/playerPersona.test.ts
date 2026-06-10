import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

// Regression: the OOBE data the player types (their own words for archetype + strategy) must
// reach the LLM-facing projection so the game master can voice them as described. The earlier
// build discarded any non-canonical archetype/style — the player typed "the underdog" and the
// engine silently replaced it with a canonical label, so the narration ignored the player's
// self-description ("the LLM responds as if entirely unaware"). The fix surfaces the player's
// words in the view + moment prompt WITHOUT letting them drive stats (anti-sycophancy, 0006).
describe("0023/0027 — the player's typed persona reaches the narrative", () => {
  it("surfaces the player's OWN free-text archetype/strategy in the state view", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({
      playerName: "The Player",
      archetype: "the lovable underdog",   // not a canonical archetype enum value
      strategyStyle: "a quiet social floater",
      seed: 7,
    });
    const v = s.getGameState();
    expect(v.started).toBe(true);
    expect(v.player!.archetype).toBe("the lovable underdog");
    expect(v.player!.strategyStyle).toBe("a quiet social floater");
  });

  it("weaves those exact words into the injected moment prompt", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({
      playerName: "The Player",
      archetype: "the lovable underdog",
      strategyStyle: "a quiet social floater",
      seed: 7,
    });
    const { systemPrompt } = s.getMomentPrompt({});
    expect(systemPrompt).toContain("The Player");
    expect(systemPrompt).toContain("the lovable underdog");
    expect(systemPrompt).toContain("a quiet social floater");
  });

  it("falls back to a canonical label when the player types nothing", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 7 });
    const v = s.getGameState();
    expect(typeof v.player!.archetype).toBe("string");
    expect(v.player!.archetype.length).toBeGreaterThan(0);
    expect(typeof v.player!.strategyStyle).toBe("string");
    expect(v.player!.strategyStyle.length).toBeGreaterThan(0);
  });

  it("the free-text persona never leaks engine stats into the projection (Vault-free)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", archetype: "schemer", strategyStyle: "ruthless", seed: 3 });
    const view = s.getGameState();
    // The casting card (0050) is the ONE sanctioned qualitative read of the player's own
    // aptitudes: per-aptitude tier WORDS. Verify it carries words, then exclude it from the
    // banned-substring scan (its keys legitimately name the aptitudes; its values never do).
    const card = view.player!.castingCard!;
    for (const tier of [card.strengths.physical, card.strengths.mental, card.strengths.social]) {
      expect(["standout", "solid", "scrappy"]).toContain(tier);
    }
    const { castingCard: _card, ...playerSansCard } = view.player!;
    const blob = JSON.stringify({ ...view, player: playerSansCard });
    for (const banned of ["physical", "mental", "social", "stats", "soul", "emotional", "volatility"]) {
      expect(blob.includes(banned)).toBe(false);
    }
    // And no numeric value ever rides along anywhere — the card included (engine stats are floats).
    expect(JSON.stringify(view)).not.toMatch(/\d\.\d/);
  });
});
