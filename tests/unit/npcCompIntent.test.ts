import { describe, it, expect } from "vitest";
import {
  deriveNpcCompIntent, COMP_INTENT_THRESHOLDS, newLiveSeason, peekCompetition, type SeasonCtx,
} from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { Stats } from "../../src/engine/season";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

/**
 * Feature 0006b (PO review 2026-06-28): NPCs carry a competition INTENT too, not just the player. It is
 * DERIVED (a nominee fights; a lay-low houseguest with a strong ally in the field throws to hand them the
 * power; a cautious houseguest a competitor reads as a real threat plays safe) and OCCASIONAL by design.
 * The layer is opt-in (`ORWELL_COMP_INTENT`): absent ⇒ every NPC competes ⇒ the seeded spine is
 * byte-identical. HARD rule: roles only — no names.
 */

const flat = (v: number): Stats => ({ physical: v, mental: v, social: v });

describe("0006b — deriveNpcCompIntent (the pure strategic decision)", () => {
  const base = { aggression: 0.25, nominee: false, bestAllyBond: 0.1, maxThreatOnMe: 0.1, hasOthers: true };

  it("a NOMINEE always competes (fighting for their life), even lay-low with a strong ally", () => {
    expect(deriveNpcCompIntent({ ...base, nominee: true, bestAllyBond: 0.9, maxThreatOnMe: 0.9 })).toBe("compete");
  });

  it("a lone competitor just competes (no ally to hand it to, no rival to fear)", () => {
    expect(deriveNpcCompIntent({ ...base, hasOthers: false })).toBe("compete");
  });

  it("a LAY-LOW houseguest with a strongly-trusted ally in the field THROWS", () => {
    expect(deriveNpcCompIntent({ ...base, aggression: 0.25, bestAllyBond: 0.8 })).toBe("throw");
  });

  it("a lay-low houseguest with only a WEAK ally competes (the ally isn't worth handing it to)", () => {
    expect(deriveNpcCompIntent({ ...base, aggression: 0.25, bestAllyBond: 0.5 })).toBe("compete");
  });

  it("a HIGH-aggression houseguest never lays low — competes even with a strong ally present", () => {
    expect(deriveNpcCompIntent({ ...base, aggression: 0.85, bestAllyBond: 0.9 })).toBe("compete");
  });

  it("a CAUTIOUS houseguest a competitor reads as a real threat PLAYS SAFE (avoids the bigger target)", () => {
    expect(deriveNpcCompIntent({ ...base, aggression: 0.5, maxThreatOnMe: 0.7 })).toBe("play-safe");
  });

  it("a cautious houseguest under only a LOW threat read competes", () => {
    expect(deriveNpcCompIntent({ ...base, aggression: 0.5, maxThreatOnMe: 0.3 })).toBe("compete");
  });

  it("THROW takes precedence over play-safe when both would qualify (help the ally first)", () => {
    expect(deriveNpcCompIntent({ ...base, aggression: 0.25, bestAllyBond: 0.8, maxThreatOnMe: 0.7 })).toBe("throw");
  });

  it("the thresholds are the single tunable knob (bracketing the archetype-aggression scale)", () => {
    expect(COMP_INTENT_THRESHOLDS.layLowAggression).toBeLessThan(COMP_INTENT_THRESHOLDS.cautiousAggression);
    expect(COMP_INTENT_THRESHOLDS.throwToAllyBond).toBeGreaterThan(0.5);
  });
});

describe("0006b — NPC intent is wired into the live competition (and absent ⇒ byte-identical)", () => {
  const FAV = npc(1); // a clear stat favorite
  const field = [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)];
  const statsOf = (id: EntityId): Stats => (id === FAV ? flat(0.9) : flat(0.5));
  const ctx = (compIntentOf?: SeasonCtx["compIntentOf"]): SeasonCtx => ({
    player: PLAYER, statsOf, rel: new RelationshipModel(0.5), ...(compIntentOf ? { compIntentOf } : {}),
  });
  const peekWinner = (c: SeasonCtx, seed: number): EntityId =>
    peekCompetition(newLiveSeason(field), c, new SeededRandom(seed))!.winner;

  it("forcing the favorite to THROW collapses its win rate (the NPC's intent reaches the roll)", () => {
    const RUNS = 300;
    let baseWins = 0, throwWins = 0;
    const throwFav: SeasonCtx["compIntentOf"] = (id) => (id === FAV ? "throw" : "compete");
    for (let seed = 1; seed <= RUNS; seed++) {
      if (peekWinner(ctx(), seed) === FAV) baseWins++;
      if (peekWinner(ctx(throwFav), seed) === FAV) throwWins++;
    }
    expect(baseWins).toBeGreaterThan(RUNS * 0.4);      // the favorite dominates when it competes
    expect(throwWins).toBeLessThan(baseWins * 0.25);   // …and collapses when it throws (intent reached the roll)
  });

  it("absent provider ⇒ byte-identical: an all-'compete' provider crowns the SAME winner every seed", () => {
    const allCompete: SeasonCtx["compIntentOf"] = () => "compete";
    for (let seed = 1; seed <= 200; seed++) {
      expect(peekWinner(ctx(allCompete), seed)).toBe(peekWinner(ctx(), seed));
    }
  });

  it("the live adapter drives the opening HOH with NPC intent ENABLED — no crash, deterministic", () => {
    const play = (seed: number): EntityId | undefined => {
      const s = new GameSessionAdapter();
      s.createCharacter({ playerName: "P", seed });
      s.setCompIntentEnabled(true); // derive real NPC intents from the live house
      for (let g = 0; g < 200 && !s.gameStatus().hoh; g++) {
        const adv = s.advanceGame();
        if (adv.pending?.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
        else if (adv.pending) break;
      }
      return s.gameStatus().hoh?.id;
    };
    const first = play(7);
    expect(first).toBeDefined();       // the opening HOH crowns without error
    expect(play(7)).toBe(first);       // …and the same seed reproduces it (deterministic)
  });
});
