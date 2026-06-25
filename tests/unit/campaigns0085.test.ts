import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  generateInfluence, campaignTilt, formCampaigns, replan, CAMPAIGN,
  type CampaignActor, type Campaign,
} from "../../src/engine/campaigns";
import { npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0085 Phase A — the PURE campaign foundations: influence traits, the character-mediated tilt,
 * formation, and adaptation. Roles only (a schemer, a target, an ally); seeded + deterministic; no live
 * wiring yet (so nothing here can perturb calibration).
 */

describe("0085 influence traits — archetype-correlated, bounded, byte-stable", () => {
  it("every trait lands in [0,1] and is deterministic for a seed", () => {
    const a = generateInfluence(new SeededRandom(5), "mastermind");
    const b = generateInfluence(new SeededRandom(5), "mastermind");
    expect(a).toEqual(b);
    for (const v of [a.persuasiveness, a.susceptibility]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("a mastermind out-persuades a floater on average; a follower is more swayable than an analyst", () => {
    const N = 300;
    let mastermind = 0, floater = 0, underdog = 0, analyst = 0;
    for (let i = 0; i < N; i++) {
      mastermind += generateInfluence(new SeededRandom(i), "mastermind").persuasiveness;
      floater += generateInfluence(new SeededRandom(i), "floater").persuasiveness;
      underdog += generateInfluence(new SeededRandom(i), "underdog").susceptibility;
      analyst += generateInfluence(new SeededRandom(i), "analyst").susceptibility;
    }
    expect(mastermind / N).toBeGreaterThan(floater / N); // persuasive
    expect(underdog / N).toBeGreaterThan(analyst / N); // gullible vs stubborn
  });
});

describe("0085 campaignTilt — character-mediated, not a flat knob", () => {
  it("scales with persuasiveness, susceptibility, trust, and progress; bounded to [0, base]", () => {
    const persuasive = campaignTilt(1, 0.9, 0.7, 0.5);
    const unpersuasive = campaignTilt(1, 0.3, 0.7, 0.5);
    expect(persuasive).toBeGreaterThan(unpersuasive);

    const gullible = campaignTilt(1, 0.7, 0.9, 0.5);
    const stubborn = campaignTilt(1, 0.7, 0.2, 0.5);
    expect(gullible).toBeGreaterThan(stubborn);

    expect(campaignTilt(1, 0.7, 0.7, 0.9)).toBeGreaterThan(campaignTilt(1, 0.7, 0.7, 0.1)); // trust
    expect(campaignTilt(0.2, 0.7, 0.7, 0.5)).toBeLessThan(campaignTilt(0.9, 0.7, 0.7, 0.5)); // progress

    expect(campaignTilt(1, 1, 1, 1)).toBeLessThanOrEqual(CAMPAIGN.base);
    expect(campaignTilt(0, 1, 1, 1)).toBe(0);
  });
});

describe("0085 formCampaigns — generates from goals, capped, owner-only knowledge", () => {
  const actor = (id: EntityId, persuasiveness: number, over: Partial<CampaignActor> = {}): CampaignActor => ({
    id, persuasiveness, threats: [], allies: [], ...over,
  });

  it("a threatened houseguest forms an EVICT campaign against the threat — known to the owner only", () => {
    const [schemer, threat] = [npc(1), npc(2)];
    const camps = formCampaigns(
      [actor(schemer, 0.8, { threats: [{ toward: threat, threat: 0.8 }] })],
      { rng: new SeededRandom(1), beat: 3 },
    );
    expect(camps).toHaveLength(1);
    expect(camps[0]).toMatchObject({ goal: "evict", target: threat, owners: [schemer], status: "active" });
    expect(camps[0]!.knownTo).toEqual([schemer]); // symmetric perspective — owner only at formation
    expect(camps[0]!.plan.length).toBeGreaterThan(0);
    expect(camps[0]!.deadlineBeat).toBeGreaterThan(camps[0]!.startedBeat);
  });

  it("falls back to a build-alliance on a strong bond; forms nothing without a strong read", () => {
    const [schemer, ally] = [npc(1), npc(3)];
    const built = formCampaigns([actor(schemer, 0.7, { allies: [{ toward: ally, affinity: 0.8 }] })], { rng: new SeededRandom(1), beat: 1 });
    expect(built[0]).toMatchObject({ goal: "build-alliance", target: ally, horizon: "season" });

    const none = formCampaigns([actor(schemer, 0.7, { threats: [{ toward: ally, threat: 0.2 }], allies: [{ toward: ally, affinity: 0.3 }] })], { rng: new SeededRandom(1), beat: 1 });
    expect(none).toHaveLength(0);
  });

  it("caps concurrent campaigns and prioritizes the most persuasive schemers", () => {
    const actors = Array.from({ length: CAMPAIGN.maxConcurrent + 3 }, (_, i) =>
      actor(npc(i + 1), 0.3 + i * 0.05, { threats: [{ toward: npc(99), threat: 0.9 }] }));
    const camps = formCampaigns(actors, { rng: new SeededRandom(1), beat: 1 });
    expect(camps.length).toBe(CAMPAIGN.maxConcurrent);
    // The owners are the highest-persuasiveness actors (the last few in the ascending list).
    const owners = new Set(camps.map((c) => c.owners[0]));
    expect(owners.has(npc(actors.length))).toBe(true); // the most persuasive made the cut
    expect(owners.has(npc(1))).toBe(false); // the least did not
  });

  it("is deterministic", () => {
    const a = [actor(npc(1), 0.8, { threats: [{ toward: npc(2), threat: 0.7 }] })];
    expect(formCampaigns(a, { rng: new SeededRandom(9), beat: 2 }))
      .toEqual(formCampaigns(a, { rng: new SeededRandom(9), beat: 2 }));
  });
});

describe("0085 replan — adapts, never silently vanishes", () => {
  const base: Campaign = {
    id: "c1", owners: [npc(1)], goal: "evict", target: npc(2), plan: ["lobby"], progress: 0.4,
    horizon: "week", status: "active", startedBeat: 1, deadlineBeat: 6, confidence: 0.7, knownTo: [npc(1)],
  };

  it("re-targets when the target escapes (no longer active)", () => {
    const out = replan(base, { active: new Set([npc(1), npc(3)]), ownerEndangered: false, threats: [{ toward: npc(3), threat: 0.7 }] });
    expect(out.target).toBe(npc(3));
    expect(out.status).toBe("active");
  });

  it("abandons (never vanishes) when the target is gone and no threat remains", () => {
    const out = replan(base, { active: new Set([npc(1)]), ownerEndangered: false, threats: [] });
    expect(out.status).toBe("abandoned");
  });

  it("pivots to self-protect when the owner is endangered", () => {
    const out = replan(base, { active: new Set([npc(1), npc(2)]), ownerEndangered: true });
    expect(out).toMatchObject({ goal: "protect", target: npc(1) });
  });

  it("leaves an on-track campaign unchanged and never mutates the input", () => {
    const frozen = JSON.stringify(base);
    const out = replan(base, { active: new Set([npc(1), npc(2)]), ownerEndangered: false });
    expect(out).toBe(base); // unchanged ⇒ same reference is fine
    expect(JSON.stringify(base)).toBe(frozen);
  });
});
