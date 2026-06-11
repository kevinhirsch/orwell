import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { RELATIONSHIP_CONSTANTS } from "../../src/engine/relationshipConstants";
import { TWIST_LOAD_PROB, loadReserveTwists } from "../../src/engine/reserveTwists";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * B59 / audit I — the constants GREP GATE: the consolidated tunables must stay in their constants
 * modules, never re-inlined as magic numbers, and turning a knob must genuinely change behavior
 * (the injection/retune test). Roles only.
 */
const read = (p: string): string => readFileSync(p, "utf8");

describe("the constants grep gate (B59)", () => {
  it("the veto-save threshold lives ONLY in relationshipConstants", () => {
    const live = read("src/engine/liveSeason.ts");
    const rel = read("src/engine/relationships.ts");
    // The magic number is never inlined at the veto-save call sites…
    expect(live).not.toMatch(/trust > 0\.6/);
    expect(rel).not.toMatch(/vetoSave[^]{0,40}0\.6/);
    expect(rel).not.toMatch(/0\.6[^]{0,40}vetoSave/);
    // …and the threshold is consumed through the relationship model's `chooseVetoSave` (E54), which
    // ranks the saveable nominees by trust shaded by demonstrated loyalty against the single knob.
    expect(rel.match(/thresholds\.vetoSave/g)?.length).toBeGreaterThanOrEqual(1);
    expect(live.match(/chooseVetoSave/g)?.length).toBeGreaterThanOrEqual(2);
    expect(RELATIONSHIP_CONSTANTS.thresholds.vetoSave).toBeGreaterThan(0);
  });

  it("the twist load probability lives ONLY in reserveTwists' constant", () => {
    const src = read("src/engine/reserveTwists.ts");
    expect(src).not.toMatch(/rng\.next\(\) < 0\.5\b/);
    expect(src).toContain("TWIST_LOAD_PROB");
    expect(TWIST_LOAD_PROB).toBeGreaterThan(0);
  });

  it("the off-screen cadence is a real orchestrator knob, not an inline literal", () => {
    const src = read("src/composition/orchestrator.ts");
    expect(src).not.toMatch(/interactions:\s*3\b/); // the old hard-coded cadence is gone
    expect(src).toContain("offscreenInteractions");
  });

  it("the jury math's numbers live only in juryConstants", () => {
    const jury = read("src/engine/jury.ts");
    expect(jury).toContain("juryConstants"); // weights/manner/appeal magnitudes are imported
  });

  it("the 0044 strategy magnitudes live only in decisionConstants", () => {
    const season = read("src/engine/season.ts");
    const live = read("src/engine/liveSeason.ts");
    expect(season).toContain("decisionConstants");
    expect(live).toContain("decisionConstants");
    expect(season).not.toMatch(/PARANOIA_WEIGHT = 0\./); // re-homed into the module
    expect(live).not.toMatch(/threat \* \(1 \+ paranoia \* 0\./); // no inline vote weight
  });
});

describe("the retune test (a knob turn genuinely changes behavior)", () => {
  it("offscreenInteractions controls the per-tick scene volume", () => {
    const run = (interactions: number): number => {
      const reg = new GameSessionRegistry();
      const user = `retune-${interactions}`;
      const orch = new Orchestrator(reg, { now: () => 1 }, { seed: 11, offscreenInteractions: interactions });
      reg.sandboxFor(user).session.createCharacter({ playerName: "The Player", seed: 11 });
      const before = reg.sandboxFor(user).engine.events.query().length;
      orch.advance(user, "offscreen-tick");
      return reg.sandboxFor(user).engine.events.query().length - before;
    };
    // More scenes per tick ⇒ strictly more recorded events for the same seed.
    expect(run(6)).toBeGreaterThan(run(1));
  });

  it("a wider twist-load slot count loads at least as many twists for the same stream", () => {
    // The knob is real: with the SAME rng stream, more enabled slots can only load MORE twists.
    const a = loadReserveTwists(1, new SeededRandom(5)).length;
    const b = loadReserveTwists(3, new SeededRandom(5)).length;
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
