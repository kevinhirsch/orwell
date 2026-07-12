import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { strategicDriveWeight, STRATEGIC_CADENCE } from "../../src/engine/offscreen";
import { PLAYER } from "../../src/domain/ids";

/**
 * Feature 0120 (PO expansion of the 0038 review) — the STRATEGIC-DRIVE off-screen cadence: sharper /
 * more-strategic houseguests INITIATE the hidden off-screen scheming a touch more often (a SLIGHT,
 * bounded variance — the owner's "not wildly skewed"). Opt-in via `ORWELL_STRATEGIC_CADENCE`; OFF ⇒ the
 * uniform draw exactly (byte-identical, calibration-safe). Roles only.
 */

describe("0120 — the strategic-drive weight is monotonic, bounded, and only SLIGHT", () => {
  it("a sharper mind (and a scheming style) weighs more than a passive one", () => {
    expect(strategicDriveWeight(0.9)).toBeGreaterThan(strategicDriveWeight(0.2)); // strategic intelligence
    expect(strategicDriveWeight(0.5, "strategic")).toBeGreaterThan(strategicDriveWeight(0.5, "under-the-radar")); // personality
    expect(strategicDriveWeight(0.5, "aggressive")).toBeGreaterThan(strategicDriveWeight(0.5, "loyal"));
  });

  it("every weight is positive and the skew is SLIGHT (never a wild dominance)", () => {
    const hi = strategicDriveWeight(1, "strategic");
    const lo = strategicDriveWeight(0, "under-the-radar");
    expect(lo).toBeGreaterThan(0);
    expect(hi / lo).toBeLessThan(3); // the sharpest schemes < 3× the most passive — "slight", not dominant
  });

  it("clamps out-of-range mental and is a pure function of its inputs", () => {
    expect(strategicDriveWeight(5)).toBe(strategicDriveWeight(1)); // clamped high
    expect(strategicDriveWeight(-5)).toBe(strategicDriveWeight(0)); // clamped low
    expect(STRATEGIC_CADENCE.floor).toBeGreaterThan(0);
  });
});

// The off-screen society's rng is seeded per USER (B60/E12 — each user's stream is their own), so
// determinism is per (seed AND user): a comparison must hold the user name fixed and vary only the knob,
// or the difference is (uninterestingly) the different rng stream, not the cadence flag.
function society(seed: number, cadenceOn: boolean, user = "sc-cmp"): { sb: ReturnType<GameSessionRegistry["sandboxFor"]>; orch: Orchestrator; user: string } {
  const reg = new GameSessionRegistry();
  const orch = new Orchestrator(reg, { now: () => seed }, { seed });
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  sb.session.setStrategicCadenceEnabled(cadenceOn);
  return { sb, orch, user };
}

const societyStream = (sb: ReturnType<GameSessionRegistry["sandboxFor"]>): string[] =>
  sb.engine.events.queryAll()
    .filter((e) => e.hidden && e.id.startsWith("offscreen:"))
    .map((e) => `${e.initiator}:${e.type}:${e.content}`);

describe("0120 — the adapter's initiatorDrive reflects strategic intelligence", () => {
  it("a higher-Mental houseguest carries a higher drive", () => {
    const { sb } = society(7, true);
    const npcs = sb.session.snapshot().house!.npcs;
    const sharpest = [...npcs].sort((a, b) => b.character.stats.mental - a.character.stats.mental)[0]!;
    const dullest = [...npcs].sort((a, b) => a.character.stats.mental - b.character.stats.mental)[0]!;
    expect(sb.session.initiatorDrive(sharpest.id)).toBeGreaterThan(sb.session.initiatorDrive(dullest.id));
  });
});

describe("0120 — OFF is byte-identical; ON changes who schemes, and stays seed-deterministic", () => {
  it("with the cadence OFF, the same seed yields the identical society (uniform draw, calibration-safe)", () => {
    const a = society(33, false);
    const b = society(33, false);
    for (let t = 0; t < 8; t++) { a.orch.advance(a.user, "offscreen-tick"); b.orch.advance(b.user, "offscreen-tick"); }
    expect(societyStream(a.sb)).toEqual(societyStream(b.sb));
  });

  it("with the cadence ON, the same seed is still deterministic", () => {
    const a = society(33, true);
    const b = society(33, true);
    for (let t = 0; t < 8; t++) { a.orch.advance(a.user, "offscreen-tick"); b.orch.advance(b.user, "offscreen-tick"); }
    expect(societyStream(a.sb)).toEqual(societyStream(b.sb));
  });

  it("turning the cadence ON changes the society (the strategic weighting actually takes effect)", () => {
    // Over a seed set, at least one shows a different initiator pattern ON vs OFF (co-presence can make a
    // few coincide; the weighting genuinely shifts who initiates).
    let changed = false;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const off = society(seed, false);
      const on = society(seed, true);
      for (let t = 0; t < 12; t++) { off.orch.advance(off.user, "offscreen-tick"); on.orch.advance(on.user, "offscreen-tick"); }
      if (JSON.stringify(societyStream(off.sb)) !== JSON.stringify(societyStream(on.sb))) { changed = true; break; }
    }
    expect(changed, "the strategic cadence changes the off-screen initiator pattern").toBe(true);
  });

  it("the ON cadence never breaks the Vault Wall — no off-screen scene is witnessed by the player", () => {
    const { sb, orch, user } = society(41, true);
    for (let t = 0; t < 10; t++) orch.advance(user, "offscreen-tick");
    const scenes = sb.engine.events.queryAll().filter((e) => e.hidden && e.id.startsWith("offscreen:"));
    expect(scenes.length).toBeGreaterThan(0);
    for (const s of scenes) expect(s.witnessSet.includes(PLAYER)).toBe(false);
  });
});
