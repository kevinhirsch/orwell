import { describe, it, expect } from "vitest";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { VisibleStateService } from "../../src/services/VisibleStateService";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Issue #1239 (M4-2 Memory Wall projection audit) — the outward player-knowledge projection
 * (`VisibleStateService.getVisibleStateFor(PLAYER).knowledge`) must be Vault-safe by CONSTRUCTION:
 *
 *   1. it must NOT carry `originalContent` — the undistorted TRUTH behind a distorted belief (leaking
 *      it collapses the 0002/0094 dramatic irony the player does not hold);
 *   2. it must NOT carry the raw belief NUMBERS (`confidence` / `distortion` / `hops`) — "never show
 *      the player a number", and the number shouldn't cross the boundary at all;
 *   3. instead it exposes Vault-safe QUALITATIVE fields: a `confidenceBand` clarity word + a
 *      `distorted` boolean.
 *
 * Roles only — no names.
 */
describe("#1239 — the player-knowledge projection strips truth + raw numbers, exposes qualitative bands", () => {
  const RAW_NUMERIC_KEYS = ["confidence", "distortion", "hops", "originalContent"] as const;

  it("a materially-distorted belief the player holds carries no truth/number, only a `distorted` band", () => {
    const core = buildEngineCore();
    // A sentinel distorted belief: far-travelled (high distortion), decayed (low confidence), and it
    // remembers its undistorted origin. Seeded straight into the player's knowledge as the fixture.
    core.knowledge.seedBelief(
      PLAYER,
      {
        content: "a wildly warped rumor about the vote",
        originalContent: "the ACTUAL undistorted truth about the vote",
        factId: "d1",
        confidence: 0.4,
        hops: 3,
        distortion: 2.5,
      },
      "told-by:npc:2",
    );

    const svc = new VisibleStateService(core.events, core.knowledge);
    const facts = svc.getVisibleStateFor(PLAYER).knowledge;
    expect(facts).toHaveLength(1);
    const fact = facts[0]!;

    // 1 + 2 — the leak/number keys are gone AND the truth string never appears anywhere.
    for (const key of RAW_NUMERIC_KEYS) {
      expect(fact, `outward knowledge must not carry ${key}`).not.toHaveProperty(key);
    }
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain("the ACTUAL undistorted truth");

    // 3 — the qualitative Vault-safe fields are present; this belief classifies as distorted.
    expect(typeof fact.confidenceBand).toBe("string");
    expect(fact.confidenceBand!.length).toBeGreaterThan(0);
    expect(fact.distorted).toBe(true);
  });

  it("a faithful witnessed fact projects `distorted:false` with a confident band and no raw numbers", () => {
    const core = buildEngineCore();
    core.knowledge.seedBelief(PLAYER, { content: "something the player saw firsthand", factId: "w1" }, "witnessed");

    const svc = new VisibleStateService(core.events, core.knowledge);
    const fact = svc.getVisibleStateFor(PLAYER).knowledge[0]!;

    for (const key of RAW_NUMERIC_KEYS) {
      expect(fact).not.toHaveProperty(key);
    }
    expect(fact.distorted).toBe(false); // no drift/decay recorded ⇒ never distorted
    expect(fact.confidenceBand).toBe("clearly"); // default certainty
    expect(fact.content).toBe("something the player saw firsthand");
    expect(fact.pathway).toBe("witnessed");
  });

  it("a lightly-drifted, confidently-held belief is NOT flagged distorted (both gates must clear)", () => {
    const core = buildEngineCore();
    // One-hop retelling: some drift but still confident — a faithful belief must not misfire.
    core.knowledge.seedBelief(
      PLAYER,
      { content: "a one-hop retelling", originalContent: "a one-hop retelling", factId: "l1", confidence: 0.8, hops: 1, distortion: 1 },
      "told-by:npc:3",
    );

    const svc = new VisibleStateService(core.events, core.knowledge);
    const fact = svc.getVisibleStateFor(PLAYER).knowledge[0]!;
    expect(fact.distorted).toBe(false);
    expect(fact).not.toHaveProperty("originalContent");
  });
});
