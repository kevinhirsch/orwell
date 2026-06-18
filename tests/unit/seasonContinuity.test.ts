import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { CreateCharacterReq } from "../../src/ports/GameSession";

/**
 * Feature 0056 — season-to-season character continuity. A confirmed restart can KEEP the existing
 * houseguest (the same static CHARACTER returns to a NEW cast) or RECREATE (fresh casting). Carry-
 * over is byte-faithful because the player's CHARACTER is seed-independent (stats = archetype bias,
 * appearance = hash of the name). HARD rule: roles only — no fixture names asserted as canonical.
 */

const SEASON_1: CreateCharacterReq = {
  playerName: "The Returning Houseguest",
  archetype: "comp-beast",
  strategyStyle: "aggressive",
  personaArchetype: "the gym-rat next door",
  personaStrategyStyle: "win everything, apologize never",
  backstory: "A welder from a small mountain town.",
  motivation: "to prove the underdog can out-muscle the house.",
  privateStrategy: "throw the first comp, then never lose another.",
  interviewNotes: ["collects vintage axes", "terrified of the diary-room chair"],
  seed: 4242,
};

/** The player-card facets that prove the SAME static character (no hidden number among them). */
function identityOf(view: ReturnType<GameSessionAdapter["getGameState"]>) {
  const p = view.player!;
  return {
    name: p.name,
    archetype: p.archetype,
    strategyStyle: p.strategyStyle,
    card: p.castingCard,
  };
}

const castNames = (view: ReturnType<GameSessionAdapter["getGameState"]>): string[] =>
  view.house.map((h) => h.name).sort();

describe("0056 — keep the existing character (standalone fidelity)", () => {
  it("a confirmed restart with keepCharacter regenerates the SAME static character under a NEW cast", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ ...SEASON_1 });
    const before = identityOf(s.getGameState());
    const cast1 = castNames(s.getGameState());

    // Keep the character; a NEW seed draws a NEW house.
    s.createCharacter({ confirmRestart: true, keepCharacter: true, seed: 9001 });
    const after = identityOf(s.getGameState());
    const cast2 = castNames(s.getGameState());

    // The houseguest is byte-identical (name / archetype / strategy / qualitative card all match)…
    expect(after).toEqual(before);
    // …while the CAST genuinely changed (a different seed).
    expect(cast2).not.toEqual(cast1);
    // The new season is a fresh start (week 1), not a resurrection of the old one.
    expect(s.getGameState().week).toBe(1);
  });

  it("keep carries the authored persona, backstory, and motivation through to the new casting card", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ ...SEASON_1 });
    s.createCharacter({ confirmRestart: true, keepCharacter: true, seed: 7 });
    const card = s.getGameState().player!.castingCard!;
    expect(card.story).toBe(SEASON_1.backstory);
    expect(card.motivation).toBe(SEASON_1.motivation);
    expect(card.characterType).toBe(SEASON_1.archetype);
    expect(card.strategyStyle).toBe(SEASON_1.strategyStyle);
  });

  it("explicit fields on the keep restart override field-by-field (a tweak for the new season)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ ...SEASON_1 });
    // Keep everything, but enter the new season with a fresh strategy ("strategic" is a valid
    // comp-beast style, so the override survives runPlayerOOBE's archetype-style normalization).
    s.createCharacter({ confirmRestart: true, keepCharacter: true, strategyStyle: "strategic", seed: 5 });
    const card = s.getGameState().player!.castingCard!;
    expect(card.strategyStyle).toBe("strategic");       // the tweak took
    expect(card.story).toBe(SEASON_1.backstory);         // everything untouched carried over
    expect(s.getGameState().player!.name).toBe(SEASON_1.playerName);
  });

  it("no number crosses on carry-over (the kept-season payload is sentinel-free of stats)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ ...SEASON_1 });
    const json = JSON.stringify(s.createCharacter({ confirmRestart: true, keepCharacter: true, seed: 3 }));
    // The card carries tier WORDS only; no raw physical/mental/social number rides out.
    expect(json).toMatch(/scrappy|solid|standout/);
    expect(json).not.toMatch(/"physical":\s*0?\.\d/);
    expect(json).not.toMatch(/"mental":\s*0?\.\d/);
    expect(json).not.toMatch(/"social":\s*0?\.\d/);
  });
});

describe("0056 — recreate (a fresh character) and the guards", () => {
  it("a confirmed restart WITHOUT keepCharacter starts a genuinely different character", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ ...SEASON_1 });
    s.createCharacter({
      confirmRestart: true,
      playerName: "A Brand-New Player",
      archetype: "social-butterfly",
      strategyStyle: "social",
      seed: 11,
    });
    const p = s.getGameState().player!;
    expect(p.name).toBe("A Brand-New Player");
    expect(p.castingCard!.characterType).toBe("social-butterfly");
  });

  it("keepCharacter is ignored without confirmRestart (the no-op refusal still protects the game)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ ...SEASON_1 });
    const view = s.createCharacter({ keepCharacter: true, playerName: "Should Not Apply" });
    // No confirmRestart ⇒ the season is untouched and the refusal is signalled (R4-05), not a restart.
    expect(view.createRefused).toBe("in-progress");
    expect(s.getGameState().player!.name).toBe(SEASON_1.playerName);
  });

  it("keepCharacter on a FRESH (no prior game) creation is a harmless no-op", () => {
    const s = new GameSessionAdapter();
    // Nothing to carry — it behaves as a normal first creation from the supplied fields.
    s.createCharacter({ playerName: "First Timer", archetype: "comp-beast", keepCharacter: true, seed: 2 });
    expect(s.getGameState().started).toBe(true);
    expect(s.getGameState().player!.name).toBe("First Timer");
  });
});

describe("0056 — keep through the ONE sanctioned restart door (registry / D1-R1)", () => {
  it("season 2 keeps the character, draws a fresh cast, and commits clean through resetUser", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("returning-player");
    sb.session.createCharacter({ ...SEASON_1 });
    const before = identityOf(sb.session.getGameState());
    const cast1 = castNames(sb.session.getGameState());

    // The confirmed keep restart routes through onRestart → resetUser (the same hinge the admin
    // reset uses) — a fresh sandbox, the dead season forgotten — and recreates the SAME player there.
    sb.session.createCharacter({ confirmRestart: true, keepCharacter: true, seed: 8080 });

    // The registry now serves the season-2 sandbox for this user.
    const s2 = reg.sandboxFor("returning-player").session;
    expect(identityOf(s2.getGameState())).toEqual(before);
    expect(castNames(s2.getGameState())).not.toEqual(cast1);
    expect(s2.getGameState().week).toBe(1);
    expect(s2.getGameState().started).toBe(true);
  });
});
