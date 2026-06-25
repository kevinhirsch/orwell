import { describe, it, expect } from "vitest";
import { voteChoice, type SeasonCtx } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { campaignTilt } from "../../src/engine/campaigns";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0085 Phase B1 — the seeded eviction-vote TILT. The campaign push enters `voteChoice` as an
 * OPTIONAL ctx provider (`campaignTiltFor`): absent ⇒ 0 ⇒ byte-identical to the pre-feature vote (so the
 * juryReach calibration spine is untouched until the live adapter wires it in B2). When present, a
 * campaign to evict a nominee the voter is aware of pushes the seeded vote toward them, CHARACTER-mediated.
 * Roles only: a voter, two nominees (a, b), a schemer's campaign.
 */

const [voter, a, b] = [npc(5), npc(1), npc(2)];

/** A house where the voter narrowly reads `a` as the bigger threat (so a clean baseline vote of `a`). */
function narrowRead(): RelationshipModel {
  const rel = new RelationshipModel(0.5);
  rel.edge(voter, a).threat = 0.42;
  rel.edge(voter, b).threat = 0.40;
  return rel;
}

function ctx(rel: RelationshipModel, campaignTiltFor?: (t: EntityId, v: EntityId) => number): SeasonCtx {
  return {
    player: PLAYER,
    statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }),
    rel,
    ...(campaignTiltFor ? { campaignTiltFor } : {}),
  };
}

describe("0085 vote tilt — absent ⇒ byte-identical (the calibration guard)", () => {
  it("no provider and a zero provider produce the IDENTICAL vote", () => {
    const rel = narrowRead();
    const baseline = voteChoice(voter, [a, b], ctx(rel));
    expect(voteChoice(voter, [a, b], ctx(rel, () => 0))).toBe(baseline);
    expect(baseline).toBe(a); // the narrow threat read stands with no campaign
  });
});

describe("0085 vote tilt — a campaign moves the seeded vote, character-mediated", () => {
  it("a persuasive owner + gullible voter campaign to evict `b` flips the vote to `b`", () => {
    const rel = narrowRead();
    // A real campaign tilt: progress 1, a very persuasive owner, a gullible voter, decent trust.
    const tilt = campaignTilt(1, 0.9, 0.9, 0.5);
    const push = (t: EntityId, v: EntityId): number => (t === b && v === voter ? tilt : 0);
    expect(voteChoice(voter, [a, b], ctx(rel))).toBe(a); // without the campaign
    expect(voteChoice(voter, [a, b], ctx(rel, push))).toBe(b); // the campaign converts the vote
  });

  it("a weak campaign (unpersuasive owner, stubborn voter) does NOT flip the vote", () => {
    const rel = narrowRead();
    const tilt = campaignTilt(1, 0.3, 0.2, 0.5); // poorly pitched at a stubborn listener
    const push = (t: EntityId, v: EntityId): number => (t === b && v === voter ? tilt : 0);
    expect(voteChoice(voter, [a, b], ctx(rel, push))).toBe(a); // the narrow read survives
  });

  it("the harder the campaign is pitched, the more it moves — monotonic", () => {
    const rel = narrowRead();
    const flipped = (persuasiveness: number, susceptibility: number): boolean => {
      const tilt = campaignTilt(1, persuasiveness, susceptibility, 0.6);
      return voteChoice(voter, [a, b], ctx(rel, (t, v) => (t === b && v === voter ? tilt : 0))) === b;
    };
    expect(flipped(0.95, 0.95)).toBe(true); // a strong, well-targeted push converts
    expect(flipped(0.2, 0.2)).toBe(false); // a weak one does not
  });

  it("is deterministic — same inputs, same vote (engine tallies; nothing random)", () => {
    const rel = narrowRead();
    const push = (t: EntityId, v: EntityId): number => (t === b && v === voter ? campaignTilt(1, 0.9, 0.9, 0.5) : 0);
    expect(voteChoice(voter, [a, b], ctx(rel, push))).toBe(voteChoice(voter, [a, b], ctx(rel, push)));
  });

  it("a campaign the voter is NOT aware of does not move their vote (symmetric perspective)", () => {
    const rel = narrowRead();
    // The provider returns the tilt only for AWARE voters (knownTo) — here the voter is not aware ⇒ 0.
    const pushOnlyForOthers = (t: EntityId, v: EntityId): number => (t === b && v !== voter ? campaignTilt(1, 0.9, 0.9, 0.5) : 0);
    expect(voteChoice(voter, [a, b], ctx(rel, pushOnlyForOthers))).toBe(a);
  });
});
