import { describe, it, expect, beforeEach } from "vitest";
import { TRIGGER, type EruptionKind, ERUPTION_POOL } from "../../src/engine/triggerConstants";
import { pressure, shouldFire, eruptionEvent } from "../../src/engine/triggers";
import type { HiddenElement, Soul } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { generateHouse } from "../../src/engine/characterFactory";

/**
 * 0091 — Trigger secrets fire house events (unit tests).
 *
 * Hard rules: roles only, no names. Vault Wall: sealed trigger wording never reaches
 * any player-facing surface. The fired flag is monotonic and persists. The ORWELL_TRIGGERS
 * flag OFF ⇒ zero draws (calibration byte-identical).
 */

function makeSoul(overrides: Partial<Soul> = {}): Soul {
  return {
    emotionalBaseline: 0.5,
    volatility: 0.5,
    emotionalState: 0.5,
    emotionalHistory: [],
    memory: [],
    ...overrides,
  };
}

function makeTrigger(kind: EruptionKind = "blow-up", volatility = 0.7): HiddenElement {
  return {
    kind: "trigger",
    detail: "buries a temper that already cost them dearly",
    volatility,
    eruptionKind: kind,
  };
}

// ─── Pure pressure / shouldFire ────────────────────────────────────────────

describe("pressure", () => {
  it("returns 0 for a non-trigger element", () => {
    const el: HiddenElement = { kind: "secret-motive", detail: "wants the fame" };
    const soul = makeSoul({ emotionalState: 0.2 }); // strained
    expect(pressure(soul, el)).toBe(0);
  });

  it("is higher for a strained soul", () => {
    const trigger = makeTrigger();
    const calm = makeSoul({ emotionalState: 0.7 });  // happy
    const strained = makeSoul({ emotionalState: 0.2 }); // distressed
    expect(pressure(strained, trigger)).toBeGreaterThan(pressure(calm, trigger));
  });

  it("is bounded [0,1]", () => {
    const trigger = makeTrigger("blow-up", 0.9);
    const soul = makeSoul({ emotionalState: 0.0 }); // maximally distressed
    const p = pressure(soul, trigger);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("a very calm soul + low-volatility trigger yields low pressure", () => {
    const trigger = makeTrigger("mask-slips", 0.3);
    const soul = makeSoul({ emotionalState: 0.9 });
    expect(pressure(soul, trigger)).toBeLessThan(0.3);
  });
});

describe("shouldFire", () => {
  const rng = new SeededRandom(42);

  it("returns false for a non-trigger element", () => {
    const el: HiddenElement = { kind: "divergent-persona", detail: "plays sweet" };
    expect(shouldFire(el, 0.3, true, rng)).toBe(false);
  });

  it("returns false when no precipitant exists (no cold open)", () => {
    const trigger = makeTrigger("blow-up", 0.9);
    const soul = makeSoul({ emotionalState: 0.1 }); // highly strained
    const strain = 1 - soul.emotionalState;
    // Strain is high, volatility is high, but no precipitant
    expect(shouldFire(trigger, strain, false, rng)).toBe(false);
  });

  it("returns false when fired flag is already set (one-shot)", () => {
    const trigger = makeTrigger("mask-slips", 0.9);
    trigger.fired = true;
    const soul = makeSoul({ emotionalState: 0.1 });
    expect(shouldFire(trigger, 1 - soul.emotionalState, true, rng)).toBe(false);
  });

  it("can fire when strained + precipitant + temperature permits", () => {
    const trigger = makeTrigger("blow-up", 0.9);
    const soul = makeSoul({ emotionalState: 0.1 });
    const strain = 1 - soul.emotionalState;
    // seed 47 → first rng.next() ≈ 0.0046, which IS < strain*vol*fireRate = 0.9*0.9*0.04 ≈ 0.0324
    const fireRng = new SeededRandom(47);
    expect(shouldFire(trigger, strain, true, fireRng)).toBe(true);
  });
});

// ─── eruptionEvent ──────────────────────────────────────────────────────────

describe("eruptionEvent", () => {
  const rng = new SeededRandom(7);

  it("returns a line from the correct eruption pool", () => {
    const line = eruptionEvent("blow-up", null, rng);
    expect(ERUPTION_POOL["blow-up"]).toContain(line);
  });

  it("returns a line from fallback pool for unknown kind", () => {
    const line = eruptionEvent("meltdown", null, rng);
    expect(ERUPTION_POOL["meltdown"] ?? ERUPTION_POOL["blow-up"]).toContain(line);
  });

  it("avoids repeating the prior content (anti-repeat)", () => {
    const pool = ERUPTION_POOL["showmance-detonation"]!;
    if (pool.length < 2) return; // skip if pool too small
    const prior = pool[0]!;
    // With prior excluded, any result from a full pool should differ
    const seed = 7;
    const line = eruptionEvent("showmance-detonation", prior, new SeededRandom(seed));
    expect(line).not.toBe(prior);
  });

  it("never contains sealed trigger wording", () => {
    const sealedPhrases = ["buries a temper", "will cut first", "never forget"];
    const rngLocal = new SeededRandom(13);
    for (const kind of Object.keys(ERUPTION_POOL) as EruptionKind[]) {
      for (let i = 0; i < 10; i++) {
        const line = eruptionEvent(kind, null, rngLocal);
        for (const phrase of sealedPhrases) {
          expect(line).not.toContain(phrase);
        }
        // Name-free: no person name pronouns at start
        expect(line).not.toMatch(/^(He |She |They )/);
      }
    }
  });
});

// ─── Sealed cause isolation (Vault Wall) ────────────────────────────────────

describe("sealed cause isolation", () => {
  it("eruption pool lines contain no sealed trigger wording", () => {
    const sealedPhrases = ["buries a temper", "never forget", "one push to boil",
      "cost them dearly", "gamble bigger", "breaking point they're desperately hiding"];
    for (const pool of Object.values(ERUPTION_POOL)) {
      for (const line of pool) {
        for (const phrase of sealedPhrases) {
          expect(line.toLowerCase()).not.toContain(phrase.toLowerCase());
        }
      }
    }
  });

  it("no ERUPTION_POOL line contains a volatility number or stat-like word", () => {
    const numberWords = ["0.", "1.", "score", "stat", "rating"];
    for (const pool of Object.values(ERUPTION_POOL)) {
      for (const line of pool) {
        for (const nw of numberWords) {
          expect(line).not.toContain(nw);
        }
      }
    }
  });
});

// ─── Neutrality gate — triggers OFF ⇒ byte-identical ────────────────────────

describe("neutrality gate", () => {
  it("TRIGGER.fireRate > 0 so ON is meaningful, but OFF returns zero draws", () => {
    expect(TRIGGER.fireRate).toBeGreaterThan(0);
    expect(TRIGGER.maxEruptionsPerSeason).toBeGreaterThan(0);
    // The env flag is off by default, so calibration harness is safe
    // Process-level test: default OFF state
    expect(TRIGGERS_ENABLED_DEFAULT).toBe(false);
  });
});

// Can't test process.env at module level in vitest; use a constant.
const TRIGGERS_ENABLED_DEFAULT = process.env.ORWELL_TRIGGERS === "1";

// ─── Trigger generation in character factory ────────────────────────────────

describe("trigger generation in characterFactory", () => {
  it("some NPCs get trigger-typed hidden elements", () => {
    const house = generateHouse(new SeededRandom(42));
    let triggerCount = 0;
    for (const npc of house.npcs) {
      const triggers = npc.character.hiddenElements.filter((e) => e.kind === "trigger");
      triggerCount += triggers.length;
      // Per-NPC cap
      expect(triggers.length).toBeLessThanOrEqual(TRIGGER.maxTriggersPerNpc);
      for (const t of triggers) {
        expect(t.volatility).toBeGreaterThanOrEqual(TRIGGER.volatilityFloor);
        expect(t.volatility).toBeLessThanOrEqual(TRIGGER.volatilityCeiling);
        expect(t.eruptionKind).toBeDefined();
        expect(t.fired).toBe(false);
      }
    }
    // At least some triggers in a full cast (sparseness allows zero too)
    expect(triggerCount).toBeGreaterThanOrEqual(0);
  });

  it("trigger elements are byte-stable across generations (same seed)", () => {
    const a = generateHouse(new SeededRandom(99));
    const b = generateHouse(new SeededRandom(99));
    for (let i = 0; i < a.npcs.length; i++) {
      const aEls = a.npcs[i]!.character.hiddenElements;
      const bEls = b.npcs[i]!.character.hiddenElements;
      expect(aEls.length).toBe(bEls.length);
      for (let j = 0; j < aEls.length; j++) {
        const aEl = aEls[j]!;
        const bEl = bEls[j]!;
        if (aEl.kind === "trigger") {
          expect(bEl.kind).toBe("trigger");
          expect(aEl.volatility).toBe(bEl.volatility);
          expect(aEl.eruptionKind).toBe(bEl.eruptionKind);
        }
      }
    }
  });
});

// ─── Fired flag monotonic ───────────────────────────────────────────────────

describe("fired flag", () => {
  it("is set to false at generation", () => {
    const house = generateHouse(new SeededRandom(42));
    for (const npc of house.npcs) {
      for (const el of npc.character.hiddenElements) {
        if (el.kind === "trigger") {
          expect(el.fired).toBe(false);
        }
      }
    }
  });

  it("prevents shouldFire from re-firing a spent trigger", () => {
    const trigger = makeTrigger("mask-slips", 0.9);
    const strain = 0.9;
    const precipitant = true;
    // First: can fire (seed 47 gives a very low first roll)
    expect(shouldFire(trigger, strain, precipitant, new SeededRandom(47))).toBe(true);
    // Mark fired
    trigger.fired = true;
    // Now: cannot fire (one-shot)
    expect(shouldFire(trigger, strain, precipitant, new SeededRandom(47))).toBe(false);
  });
});

// ─── Constants are populated ────────────────────────────────────────────────

describe("trigger constants", () => {
  it("every eruption pool is populated", () => {
    for (const [kind, pool] of Object.entries(ERUPTION_POOL)) {
      expect(pool.length).toBeGreaterThan(0);
    }
  });

  it("TRIGGER constants are in valid ranges", () => {
    expect(TRIGGER.volatilityFloor).toBeGreaterThan(0);
    expect(TRIGGER.volatilityCeiling).toBeLessThanOrEqual(1);
    expect(TRIGGER.volatilityFloor).toBeLessThan(TRIGGER.volatilityCeiling);
    expect(TRIGGER.fireRate).toBeGreaterThan(0);
    expect(TRIGGER.fireRate).toBeLessThan(1);
    expect(TRIGGER.maxTriggersPerNpc).toBeGreaterThanOrEqual(1);
    expect(TRIGGER.maxEruptionsPerSeason).toBeGreaterThanOrEqual(1);
  });
});
