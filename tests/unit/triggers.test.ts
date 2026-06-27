import { describe, it, expect } from "vitest";
import { strain, pressure, shouldFire, eruptionEvent, ERUPTION_POOLS, type TriggerLike } from "../../src/engine/triggers";
import { TRIGGER, ERUPTION_KINDS, type EruptionKind } from "../../src/engine/triggerConstants";
import {
  startNewGame, armTriggers, TRIGGER_WORDINGS, generateHiddenElements,
  type HiddenElement,
} from "../../src/engine/characterFactory";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature 0091 — trigger secrets fire house events: the PURE-engine layer (`triggers.ts`) + the minting
 * (`characterFactory.armTriggers`). The orchestrator/adapter wiring (the Vault sweep before+after a fire,
 * the byte-identical draw-stream with the flag off) lives in `triggerEruptions.test.ts` /
 * `triggerOutcomeNeutral.test.ts`. HARD rule: roles only — no names; all fixtures generated.
 */

const aWoundTightSoul = { emotionalState: 0.1, volatility: 0.9, emotionalBaseline: 0.5 };
const aCalmSoul = { emotionalState: 0.55, volatility: 0.2, emotionalBaseline: 0.5 };
const aVolatileTrigger: TriggerLike = { volatility: 0.9, kind: "blow-up" };

describe("0091 — strain reads the live soul (the charge the player can observe accumulating)", () => {
  it("a wound-tight soul (deep distress + high volatility) clears the strain floor; a calm one does not", () => {
    expect(strain(aWoundTightSoul)).toBeGreaterThanOrEqual(TRIGGER.strainFloor);
    expect(strain(aCalmSoul)).toBeLessThan(TRIGGER.strainFloor);
  });

  it("strain is bounded [0,1] and rises with distress", () => {
    const s = strain(aWoundTightSoul);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    // More distressed (lower emotionalState) ⇒ at least as much strain.
    expect(strain({ emotionalState: 0.05, volatility: 0.9 })).toBeGreaterThanOrEqual(strain({ emotionalState: 0.3, volatility: 0.9 }));
  });
});

describe("0091 — pressure = volatility × strain × precipitant (engine-owned; the no-cold-open guarantee)", () => {
  it("a fresh spark + high strain yields real pressure", () => {
    expect(pressure(0.9, 0.8, 1)).toBeGreaterThan(0);
  });

  it("NO precipitant ⇒ ZERO pressure (a trigger never fires out of a quiet stretch)", () => {
    expect(pressure(0.9, 0.9, 0)).toBe(0);
  });

  it("below the strain floor ⇒ ZERO pressure (too calm to detonate, however volatile)", () => {
    expect(pressure(1, TRIGGER.strainFloor - 0.01, 1)).toBe(0);
  });
});

describe("0091 — shouldFire (seeded, rare, deterministic)", () => {
  it("a high-pressure trigger DOES fire on the right seeded roll, and is reproducible", () => {
    // Find a seed that fires at high pressure, then prove the same seed reproduces it.
    let firingSeed = -1;
    for (let seed = 1; seed <= 500 && firingSeed < 0; seed++) {
      if (shouldFire(aVolatileTrigger, 0.95, 1, new SeededRandom(seed))) firingSeed = seed;
    }
    expect(firingSeed, "a high-pressure trigger fires on SOME seed (it is not impossible)").toBeGreaterThan(0);
    // Determinism: the SAME seed + same (strain, precipitant) ⇒ the SAME decision.
    expect(shouldFire(aVolatileTrigger, 0.95, 1, new SeededRandom(firingSeed))).toBe(true);
    expect(shouldFire(aVolatileTrigger, 0.95, 1, new SeededRandom(firingSeed))).toBe(true);
  });

  it("with NO precipitant the trigger NEVER fires on ANY seed (pressure is 0)", () => {
    for (let seed = 1; seed <= 500; seed++) {
      expect(shouldFire(aVolatileTrigger, 0.95, 0, new SeededRandom(seed)), `seed ${seed}: no spark ⇒ no fire`).toBe(false);
    }
  });

  it("a CALM houseguest with the SAME trigger never fires (strain below the floor ⇒ pressure 0)", () => {
    const calmStrain = strain(aCalmSoul);
    for (let seed = 1; seed <= 500; seed++) {
      expect(shouldFire(aVolatileTrigger, calmStrain, 1, new SeededRandom(seed)), `seed ${seed}: calm ⇒ no fire`).toBe(false);
    }
  });

  it("fires are RARE even at maximal pressure (bounded by fireRate, a treat not a flood)", () => {
    let fires = 0;
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      if (shouldFire(aVolatileTrigger, 1, 1, new SeededRandom(seed))) fires++;
    }
    // At pressure ≈ 0.9 × fireRate (0.04) the rate is a few percent — bounded well under common.
    expect(fires / N).toBeLessThan(0.12);
    expect(fires).toBeGreaterThan(0); // but it DOES fire over enough rolls (the variable-ratio payoff)
  });

  it("draws EXACTLY ONE rng value whether or not it fires (the dedicated stream stays in phase)", () => {
    let draws = 0;
    const counting = {
      next: () => { draws++; return new SeededRandom(7).next(); },
      int: (n: number) => Math.floor(0.5 * n), pick: <T,>(xs: readonly T[]) => xs[0]!,
      fork: () => new SeededRandom(1),
    };
    shouldFire(aVolatileTrigger, 0.0001, 1, counting); // pressure ~0 ⇒ won't fire, but still draws
    expect(draws).toBe(1);
  });
});

describe("0091 — eruptionEvent: a generic, name-free, sealed-wording-free public line", () => {
  const opts = { week: 3, phase: "nominations" };

  it("returns a pool line for the kind, grounded in week/day, with no sealed wording", () => {
    for (const kind of ERUPTION_KINDS) {
      const events = new InMemoryEventStore();
      const line = eruptionEvent(kind, events, new SeededRandom(1), opts);
      expect(line).toMatch(/^Week 3, day 2: /);
      const body = line.split(": ").slice(1).join(": ");
      expect(ERUPTION_POOLS[kind].includes(body)).toBe(true);
    }
  });

  it("never repeats the immediately-preceding house-event's content (anti-repeat)", () => {
    const events = new InMemoryEventStore();
    const kind: EruptionKind = "blow-up";
    let prev = "";
    for (let i = 0; i < 12; i++) {
      const line = eruptionEvent(kind, events, new SeededRandom(i + 1), opts);
      const body = line.split(": ").slice(1).join(": ");
      // Record it as a PLAYER-witnessed house-event (public, never secret) so the NEXT call's anti-repeat sees it.
      events.record({ id: `he:${i}`, ts: i, type: "house-event", initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content: line });
      if (prev) expect(body, `pool has >1 line so consecutive differ`).not.toBe(prev);
      prev = body;
    }
  });
});

describe("0091 — minting: volatile wordings arm into triggers, bounded + rare, byte-stable B50 stream", () => {
  it("armTriggers only arms a known volatile wording, never any other element, and respects the per-NPC cap", () => {
    // A hand-built element set: two volatile wordings + a non-volatile one.
    const wordings = [...TRIGGER_WORDINGS.keys()];
    const els: HiddenElement[] = [
      { kind: "divergent-persona", detail: wordings[0]! },
      { kind: "secret-motive", detail: wordings[wordings.length - 1]! },
      { kind: "pre-game-tie", detail: "shares a hometown with someone in the house" },
    ];
    armTriggers(els, new SeededRandom(1));
    const armed = els.filter((e) => e.kind === "trigger");
    expect(armed.length).toBeLessThanOrEqual(TRIGGER.maxTriggers);
    for (const a of armed) {
      expect(TRIGGER_WORDINGS.has(a.detail)).toBe(true);       // only a volatile wording ever armed
      expect(a.eruptionKind).toBe(TRIGGER_WORDINGS.get(a.detail)); // public kind from the map
      expect(typeof a.volatility).toBe("number");
      expect(a.volatility!).toBeGreaterThanOrEqual(TRIGGER.volatilityMintMin);
      expect(a.volatility!).toBeLessThanOrEqual(TRIGGER.volatilityMintMax);
    }
    // The non-volatile element is NEVER a trigger.
    expect(els.find((e) => e.detail === "shares a hometown with someone in the house")!.kind).toBe("pre-game-tie");
  });

  it("the B50 hidden-element DRAW SEQUENCE is byte-identical with vs. without the trigger side-rng", () => {
    // Same seed, same fit; the ONLY difference is whether a triggerRng is supplied. The set of (kind+detail)
    // wordings drawn must be identical — arming only DECORATES an already-drawn element (it never adds/removes
    // /reorders), so the underlying B50 draw stream is provably unchanged.
    const fit = { stats: { physical: 0.7, mental: 0.7, social: 0.5 }, publicBias: { physical: 0.5, mental: 0.5, social: 0.5 } };
    for (const seed of [1, 7, 42, 99]) {
      const a = generateHiddenElements(new SeededRandom(seed), fit);                          // no triggers armed
      const b = generateHiddenElements(new SeededRandom(seed), fit, new SeededRandom(seed));  // arming on
      const details = (els: HiddenElement[]): string => JSON.stringify(els.map((e) => e.detail));
      expect(details(b), `seed ${seed}: same details drawn`).toEqual(details(a));
      expect(b.length, `seed ${seed}: same count`).toBe(a.length);
    }
  });

  it("triggers are SPARSE across the cast (most houseguests carry none) and seed-reproducible", () => {
    let withTrigger = 0, totalNpcs = 0;
    const seen = new Set<EruptionKind>();
    for (let seed = 1; seed <= 30; seed++) {
      const a = startNewGame({ seed, playerName: "P" });
      const b = startNewGame({ seed, playerName: "P" });
      // Determinism: same seed ⇒ identical hidden elements (incl. trigger arming + volatility).
      expect(JSON.stringify(b.npcs.map((n) => n.character.hiddenElements)))
        .toBe(JSON.stringify(a.npcs.map((n) => n.character.hiddenElements)));
      for (const n of a.npcs) {
        totalNpcs++;
        const trigs = n.character.hiddenElements.filter((e) => e.kind === "trigger");
        if (trigs.length) withTrigger++;
        for (const t of trigs) seen.add(t.eruptionKind!);
      }
    }
    // SPARSE: a minority of the cast carries a trigger (the 0059 "≤2 ties" discipline) — never everyone.
    expect(withTrigger).toBeGreaterThan(0);             // the feature is not vacuous
    expect(withTrigger / totalNpcs).toBeLessThan(0.5);  // most houseguests are un-triggered
    // And every armed trigger maps to a real public eruption kind.
    for (const k of seen) expect(ERUPTION_KINDS.includes(k)).toBe(true);
  });
});
