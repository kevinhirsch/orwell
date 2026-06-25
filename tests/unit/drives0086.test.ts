import { describe, it, expect } from "vitest";
import {
  deriveDrive, ownBallotLean, DRIVE, ARCHETYPE_AGGRESSION, CAMPAIGN,
  type CampaignActor, type Drive, type DriveContext,
} from "../../src/engine/campaigns";
import { npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0086 — the PURE drive substrate: every active houseguest always carries a motivation, its
 * intensity tracks the board + who they are, the agenda is sticky, and only a TARGET drive adds the
 * bounded own-ballot vote lean. Roles only (a nominee, an aggressor, a floater, a target); seeded +
 * deterministic; no live wiring here (so nothing can perturb calibration). Vault-only by construction.
 */

const actor = (id: EntityId, over: Partial<CampaignActor> = {}): CampaignActor => ({
  id, persuasiveness: 0.5, threats: [], allies: [], ...over,
});
const ctx = (over: Partial<DriveContext> = {}): DriveContext => ({
  nominated: false, aggression: 0.5, emotional: 0.5, ...over,
});

describe("0086 deriveDrive — everyone always plays; motivation tracks the board", () => {
  it("a houseguest on the block drives hard at self-preservation", () => {
    const d = deriveDrive(actor(npc(1), { threats: [{ toward: npc(2), threat: 0.7 }] }), ctx({ nominated: true }), undefined);
    expect(d.motivation).toBe("self-preserve");
    expect(d.intensity).toBeGreaterThanOrEqual(DRIVE.nominatedIntensity);
  });

  it("a strong threat read becomes a TARGET drive aimed at the top threat", () => {
    const d = deriveDrive(actor(npc(1), { threats: [{ toward: npc(2), threat: 0.8 }, { toward: npc(3), threat: 0.3 }] }), ctx(), undefined);
    expect(d.motivation).toBe("target");
    expect(d.target).toBe(npc(2));
  });

  it("a strong bond and no threat becomes a BUILD drive toward the top ally", () => {
    const d = deriveDrive(actor(npc(1), { allies: [{ toward: npc(4), affinity: 0.8 }] }), ctx(), undefined);
    expect(d.motivation).toBe("build");
    expect(d.target).toBe(npc(4));
  });

  it("a safe, low-threat houseguest simmers at lay-low (the quiet floor everyone carries)", () => {
    const d = deriveDrive(actor(npc(1), { threats: [{ toward: npc(2), threat: 0.2 }], allies: [{ toward: npc(3), affinity: 0.3 }] }), ctx(), undefined);
    expect(d.motivation).toBe("lay-low");
    expect(d.intensity).toBeLessThan(0.5);
    expect(d.target).toBeUndefined();
  });

  it("an aggressive archetype pursues harder than a floater at the SAME board state", () => {
    const board: Partial<CampaignActor> = { threats: [{ toward: npc(9), threat: 0.8 }] };
    const aggressor = deriveDrive(actor(npc(1), board), ctx({ aggression: ARCHETYPE_AGGRESSION["villain"]! }), undefined);
    const floater = deriveDrive(actor(npc(2), board), ctx({ aggression: ARCHETYPE_AGGRESSION["floater"]! }), undefined);
    expect(aggressor.motivation).toBe("target");
    expect(floater.motivation).toBe("target");
    expect(aggressor.intensity).toBeGreaterThan(floater.intensity);
  });

  it("a rattled soul (low emotionalState) pushes intensity higher than a calm one", () => {
    const board: Partial<CampaignActor> = { threats: [{ toward: npc(9), threat: 0.8 }] };
    const rattled = deriveDrive(actor(npc(1), board), ctx({ emotional: 0.1 }), undefined);
    const calm = deriveDrive(actor(npc(1), board), ctx({ emotional: 0.5 }), undefined);
    expect(rattled.intensity).toBeGreaterThan(calm.intensity);
  });

  it("intensity is bounded to [0,1] across extremes", () => {
    const hot = deriveDrive(actor(npc(1), { threats: [{ toward: npc(2), threat: 1 }] }), ctx({ aggression: 1, emotional: 0 }), undefined);
    expect(hot.intensity).toBeGreaterThanOrEqual(0);
    expect(hot.intensity).toBeLessThanOrEqual(1);
  });

  it("is deterministic — same actor + ctx + prior derives the same drive", () => {
    const a = actor(npc(1), { threats: [{ toward: npc(2), threat: 0.7 }] });
    expect(deriveDrive(a, ctx(), undefined)).toEqual(deriveDrive(a, ctx(), undefined));
  });
});

describe("0086 deriveDrive — sticky; agendas hold until the board shifts", () => {
  const prior: Drive = { owner: npc(1), motivation: "target", target: npc(2), intensity: 0.6 };

  it("holds a prior target while it stays a live threat (no re-roll each tick)", () => {
    // The target drifts down a touch but stays inside the hysteresis band (>= threshold - hysteresis).
    const held = deriveDrive(
      actor(npc(1), { threats: [{ toward: npc(2), threat: CAMPAIGN.threatThreshold - 0.05 }, { toward: npc(3), threat: CAMPAIGN.threatThreshold + 0.1 }] }),
      ctx(), prior,
    );
    expect(held.motivation).toBe("target");
    expect(held.target).toBe(npc(2)); // sticky — NOT re-aimed at the louder npc(3)
  });

  it("re-aims on a real board change — the prior target drops below the hysteresis band", () => {
    const reaimed = deriveDrive(
      actor(npc(1), { threats: [{ toward: npc(2), threat: 0.2 }, { toward: npc(3), threat: 0.8 }] }),
      ctx(), prior,
    );
    expect(reaimed.target).toBe(npc(3)); // npc(2) fell away ⇒ re-aim at the live threat
  });

  it("nomination overrides a prior target — self-preservation dominates a real board change", () => {
    const d = deriveDrive(actor(npc(1), { threats: [{ toward: npc(2), threat: 0.7 }] }), ctx({ nominated: true }), prior);
    expect(d.motivation).toBe("self-preserve");
  });
});

describe("0086 deriveDrive — perspective-bound (symmetric Vault)", () => {
  it("reads ONLY the owner's own threat/ally reads, never an omniscient board", () => {
    // Two houseguests with identical archetype context but DIFFERENT private reads derive different drives.
    const aReads = deriveDrive(actor(npc(1), { threats: [{ toward: npc(3), threat: 0.8 }] }), ctx(), undefined);
    const bReads = deriveDrive(actor(npc(2), { allies: [{ toward: npc(3), affinity: 0.8 }] }), ctx(), undefined);
    expect(aReads.motivation).toBe("target");
    expect(bReads.motivation).toBe("build");
    // npc(1)'s drive owner is itself — never a global ledger entry.
    expect(aReads.owner).toBe(npc(1));
  });
});

describe("0086 ownBallotLean — a quiet grudge moves one vote, never the electorate", () => {
  const grudge: Drive = { owner: npc(1), motivation: "target", target: npc(2), intensity: 0.6 };

  it("a low TARGET drive leans the owner's own ballot toward evicting its target", () => {
    const lean = ownBallotLean(grudge, npc(2));
    expect(lean).toBeCloseTo(DRIVE.lowLeanWeight * 0.6, 10);
    expect(lean).toBeGreaterThan(0);
  });

  it("the lean is bounded well under a campaign's base tilt (one tier, never additive)", () => {
    expect(ownBallotLean({ ...grudge, intensity: 1 }, npc(2))).toBeLessThan(CAMPAIGN.base);
  });

  it("adds nothing against a nominee who is NOT the drive's target", () => {
    expect(ownBallotLean(grudge, npc(3))).toBe(0);
  });

  it("behavioral-only motivations add NO vote term (lay-low / build / self-preserve / win-power)", () => {
    for (const motivation of ["lay-low", "build", "self-preserve", "win-power"] as const) {
      expect(ownBallotLean({ owner: npc(1), motivation, target: npc(2), intensity: 0.9 }, npc(2))).toBe(0);
    }
  });
});
