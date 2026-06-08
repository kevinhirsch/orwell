import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { NarrativePort, NarrationContext } from "../../src/ports/NarrativePort";
import { PLAYER, npc } from "../../src/domain/ids";

// Feature 0033 (B22): the snarky, state-aware, Vault-free hero tagline.

const newGame = () => {
  const g = new GameSessionAdapter();
  g.createCharacter({ playerName: "Player", seed: 5 });
  return g;
};

describe("0033 — playerTagline", () => {
  it("returns a snarky pre-game welcome before any game exists", () => {
    const out = new GameSessionAdapter().playerTagline();
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.text).toMatch(/stranger|house|privacy|lie/i); // themed, promises no game
  });

  it("reflects the player's current public standing", () => {
    const g = newGame();
    // Force the player onto the block (Vault-free ceremony fact).
    g.updateCeremony({ nominees: [PLAYER, npc(1)] });
    const nominee = g.playerTagline().text;
    expect(nominee).toMatch(/block|targeted|put you here/i);

    g.updateCeremony({ nominees: [npc(1), npc(2)], hoh: PLAYER });
    expect(g.playerTagline().text).not.toBe(nominee); // a different standing ⇒ a different line
  });

  it("is anti-sycophantic — a weak standing is ribbed, never flattered into safety", () => {
    const g = newGame();
    g.updateCeremony({ nominees: [PLAYER, npc(1)] });
    const line = g.playerTagline().text.toLowerCase();
    expect(line).toMatch(/block|put you here/);
    expect(line).not.toMatch(/safe|you're winning|in control|nothing to worry/);
  });

  it("is one line within the hero length", () => {
    const text = newGame().playerTagline().text;
    expect(text).not.toContain("\n");
    expect(text.length).toBeLessThanOrEqual(120);
  });

  it("caches within a moment (does not regenerate per call)", () => {
    let calls = 0;
    const narrator: NarrativePort = { narrate: (_c: NarrationContext) => { calls++; return "A fresh biting welcome line."; } };
    const g = newGame();
    g.setNarrator(narrator);
    const a = g.playerTagline().text;
    const b = g.playerTagline().text;
    expect(a).toBe(b);
    expect(calls).toBe(1); // generated once for the moment, then cached
  });

  it("uses a real narrator's clean line when one is wired", () => {
    const g = newGame();
    g.setNarrator({ narrate: () => "You walked in smiling; the house is already counting your days." });
    expect(g.playerTagline().text).toBe("You walked in smiling; the house is already counting your days.");
  });

  it("fails open to the curated line when the narrator throws or dumps junk", () => {
    const thrower = new GameSessionAdapter();
    thrower.createCharacter({ playerName: "P", seed: 1 });
    thrower.setNarrator({ narrate: () => { throw new Error("LLM down"); } });
    expect(thrower.playerTagline().text).toMatch(/trust no one|house/i); // static themed line, never blank

    // An Echo-style context dump must be rejected (fail open), not shown.
    const echo = new GameSessionAdapter();
    echo.createCharacter({ playerName: "P", seed: 2 });
    echo.setNarrator({ narrate: (c) => JSON.stringify(c) });
    const text = echo.playerTagline().text;
    expect(text).not.toContain("{");
    expect(text).not.toMatch(/forEntity|visibleEvents/);
  });
});
