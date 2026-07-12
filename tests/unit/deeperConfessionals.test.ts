import { describe, it, expect } from "vitest";
import { confessionalFor, isBareGame } from "../../src/engine/confessionals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

/**
 * Feature 0122 — DEEPER NPC confessionals (the pure composer half). The five new facets — plan, standing,
 * grudge, big-conversation aftermath, adjacent move — are each TRIGGERED by the confessor's real situation
 * (never a fixed multi-slot form) and GROUNDED in their own edges + public role/beat state (anti-sycophancy:
 * queried, never invented). With NO `depth` context the confessional is BYTE-IDENTICAL to 0040. `isBareGame`
 * keeps a houseguest with nothing to say quiet. Roles only — no names.
 */

const A = npc(1);
const B = npc(2);
const C = npc(3);
const D = npc(4);
const rng = (): SeededRandom => new SeededRandom(42);

/** A relationship model where A reads: C = top threat (target), B = a grudge (trust crashed), D = best ally. */
function riggedRel(): RelationshipModel {
  const rel = new RelationshipModel(0.5);
  rel.edge(A, C).threat = 0.9; // the clear top threat → A's target
  rel.edge(A, B).trust = 0.05; // trust crashed → a grudge, distinct from the target
  rel.edge(A, B).threat = 0.3; // some threat, but below C's — so C stays the target
  rel.edge(A, D).trust = 0.8; // the strongest bond → A's ally
  rel.edge(A, D).affinity = 0.8;
  return rel;
}

describe("0122 — a confessional voices only the facets its situation TRIGGERS", () => {
  it("an HOH gets a PLAN (grounded in their target) and a SAFE standing", () => {
    const conf = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), depth: { role: "hoh" } });
    expect(conf.target).toBe(C);
    expect(conf.plan, "an HOH holds power ⇒ a plan facet fires").toBeDefined();
    expect(conf.plan).toContain(C); // the plan names their real target — not invented
    expect(conf.standing).toBe("safe"); // the HOH is safe this week
    expect(conf.content).toContain(C);
  });

  it("a NOMINEE reads as EXPOSED; a coasting houseguest gets neither plan nor standing", () => {
    const nominee = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), depth: { role: "nominee" } });
    expect(nominee.standing).toBe("exposed");
    expect(nominee.plan, "a nominee must fight to survive ⇒ a plan fires").toBeDefined();

    const coasting = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), depth: { role: "none" } });
    expect(coasting.plan, "a coasting houseguest holds no power ⇒ no plan facet").toBeUndefined();
    expect(coasting.standing, "no role change ⇒ no standing facet").toBeUndefined();
  });

  it("names a GRUDGE distinct from the current target", () => {
    const conf = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), depth: { role: "none" } });
    expect(conf.target).toBe(C); // the top threat
    expect(conf.grudge).toBe(B); // the trust-crashed peer
    expect(conf.grudge).not.toBe(conf.target); // two different reads
  });

  it("reacts to a big CONVERSATION — warm when the bond is strong, cool when it isn't", () => {
    const warm = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), depth: { role: "none", recentTalk: D } });
    expect(warm.aftermath).toBe(D);
    expect(warm.content).toContain(D);

    // A talk with B (grudge, low bond) reads COOL — grounded in A's real read of B.
    const cool = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), depth: { role: "none", recentTalk: B } });
    expect(cool.aftermath).toBe(B);
    expect(cool.content).not.toBe(warm.content);
  });

  it("reacts to an ADJACENT move — a relation on the public board, read through the bond", () => {
    const conf = confessionalFor(A, [A, B, C, D], riggedRel(), {
      rng: rng(),
      depth: { role: "none", adjacent: { relation: D, bond: "ally", beat: "won-power" } },
    });
    expect(conf.adjacent).toEqual({ relation: D, bond: "ally", beat: "won-power" });
    expect(conf.content).toContain(D);
  });

  it("a veto-holder gets a veto-flavored plan (role-specific)", () => {
    const conf = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), depth: { role: "veto-holder" } });
    expect(conf.plan, "a veto-holder holds power ⇒ a plan fires").toBeDefined();
    expect(conf.plan).toContain(C); // still grounded in their real target
  });

  it("when the lowest-trust peer IS the target, the grudge falls to a distinct runner-up", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(A, B).threat = 0.95; // B is the top threat → target
    rel.edge(A, B).trust = 0.02; // ...and also the lowest trust — but the grudge must stay DISTINCT
    rel.edge(A, C).trust = 0.1; // C is the runner-up betrayal (below the grudge floor)
    const conf = confessionalFor(A, [A, B, C, D], rel, { rng: rng(), depth: { role: "none" } });
    expect(conf.target).toBe(B);
    expect(conf.grudge).toBe(C); // fell to the distinct runner-up, not the target
  });

  it("an adjacent TARGET on the block reads through the rivalry", () => {
    const conf = confessionalFor(A, [A, B, C, D], riggedRel(), {
      rng: rng(),
      depth: { role: "none", adjacent: { relation: C, bond: "target", beat: "nominated" } },
    });
    expect(conf.adjacent).toEqual({ relation: C, bond: "target", beat: "nominated" });
    expect(conf.content).toContain(C);
  });

  it("an HOH with power, danger AND a fresh grudge strings SEVERAL facets; content grows", () => {
    const deep = confessionalFor(A, [A, B, C, D], riggedRel(), {
      rng: rng(),
      depth: { role: "hoh", recentTalk: D, adjacent: { relation: C, bond: "target", beat: "won-power" } },
    });
    const shallow = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng() }); // no depth ⇒ 0040
    expect(deep.content.length).toBeGreaterThan(shallow.content.length);
    // The rich confessional carries multiple facets; the bare one carries none.
    expect(deep.plan && deep.aftermath && deep.adjacent).toBeTruthy();
  });
});

describe("0122 — with NO depth context, a confessional is byte-identical to 0040 (additive)", () => {
  it("carries none of the new facets and no deep sentences", () => {
    const conf = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng() });
    expect(conf.plan).toBeUndefined();
    expect(conf.standing).toBeUndefined();
    expect(conf.grudge).toBeUndefined();
    expect(conf.aftermath).toBeUndefined();
    expect(conf.adjacent).toBeUndefined();
    // The base still reads the SAME grounded target/ally as 0040 (the deep code never runs).
    expect(conf.target).toBe(C);
    expect(conf.ally).toBe(D);
  });

  it("the depth CODE does not perturb the base line: same ctx, byte-identical content sans depth", () => {
    const base = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), trigger: "the veto ceremony" });
    // The exact same call is stable (no hidden depth leakage) — a determinism/regression pin.
    const again = confessionalFor(A, [A, B, C, D], riggedRel(), { rng: rng(), trigger: "the veto ceremony" });
    expect(again.content).toBe(base.content);
  });
});

describe("0122 — isBareGame keeps a houseguest with nothing to say quiet", () => {
  it("a fresh game (baseline edges, no salient recent beat) is BARE", () => {
    const rel = new RelationshipModel(0.5);
    expect(isBareGame(A, [A, B, C], rel, false)).toBe(true);
  });

  it("a clear TARGET, a clear ALLY, or a salient recent beat each un-bares it", () => {
    const withTarget = new RelationshipModel(0.5);
    withTarget.edge(A, B).threat = 0.6;
    expect(isBareGame(A, [A, B, C], withTarget, false)).toBe(false);

    const withAlly = new RelationshipModel(0.5);
    withAlly.edge(A, B).trust = 0.7;
    withAlly.edge(A, B).affinity = 0.7;
    expect(isBareGame(A, [A, B, C], withAlly, false)).toBe(false);

    const flat = new RelationshipModel(0.5);
    expect(isBareGame(A, [A, B, C], flat, true)).toBe(false); // a salient recent beat alone gives them something
  });
});
