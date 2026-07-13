import { describe, it, expect } from "vitest";
import { detectBlocs, blocTerm, blocFor, derivedLoyalty } from "../../src/engine/blocs";
import { RelationshipModel } from "../../src/engine/relationships";
import { GameSessionRegistry } from "../../src/composition/registry";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc, PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0043 — emergent blocs: DERIVED from the relationship graph at decision time, never
 * stored (decision 0002). Roles only — no fixture names.
 */
const bond = (rel: RelationshipModel, a: EntityId, b: EntityId, v: number): void => {
  const e1 = rel.edge(a, b); e1.trust = v; e1.affinity = v;
  const e2 = rel.edge(b, a); e2.trust = v; e2.affinity = v;
};

function trio(rel: RelationshipModel): EntityId[] {
  const [a, b, c] = [npc(1), npc(2), npc(3)];
  bond(rel, a, b, 0.8); bond(rel, a, c, 0.75); bond(rel, b, c, 0.7);
  return [a, b, c];
}

describe("detection (derived, bounded, deterministic)", () => {
  it("mutual bonds form a bloc with a derived shared target and cohesion", () => {
    const rel = new RelationshipModel(0.5);
    const [a, b, c] = trio(rel);
    const outsider = npc(9);
    rel.edge(a!, outsider).threat = 0.9;
    rel.edge(b!, outsider).threat = 0.8;
    rel.edge(c!, outsider).threat = 0.7;
    const blocs = detectBlocs({ rel, active: [a!, b!, c!, outsider, npc(10)] });
    expect(blocs).toHaveLength(1);
    expect(blocs[0]!.members).toEqual([a, b, c].sort());
    expect(blocs[0]!.sharedTarget).toBe(outsider);  // the aggregate-threat enemy
    expect(blocs[0]!.cohesion).toBeCloseTo(0.7, 5); // the weakest internal mutual bond
  });

  it("a bloc grows to a true clique with NO artificial size cap, and recomputes identically", () => {
    const rel = new RelationshipModel(0.5);
    const ids = Array.from({ length: 8 }, (_, i) => npc(i + 1));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bond(rel, ids[i]!, ids[j]!, 0.9);
    const blocs = detectBlocs({ rel, active: ids });
    // Eight all-trusting houseguests form ONE eight-person majority bloc — the old five-person cap is gone.
    expect(blocs).toHaveLength(1);
    expect(blocs[0]!.members).toHaveLength(8);
    // The clique requirement is now the ONLY (organic) bound: even the weakest internal bond
    // (`cohesion`) clears the threshold, so every member is mutually bonded with every other.
    expect(blocs[0]!.cohesion).toBeGreaterThanOrEqual(0.5);
    expect(JSON.stringify(detectBlocs({ rel, active: ids }))).toBe(JSON.stringify(blocs)); // same edges ⇒ same blocs
  });

  it("a one-sided bond never makes a bloc edge (mutuality required)", () => {
    const rel = new RelationshipModel(0.5);
    const e = rel.edge(npc(1), npc(2)); e.trust = 0.95; e.affinity = 0.95; // unrequited
    expect(detectBlocs({ rel, active: [npc(1), npc(2)] })).toEqual([]);
  });

  it("a bloc that spans the WHOLE active house has no shared target (now reachable without the cap)", () => {
    // With the size cap gone, a fully-bonded house forms one all-encompassing bloc — there is no
    // outsider left to target. sharedTarget must be null, and the bloc term still shields a mate
    // (a null shared target never matches a real houseguest, so it neither throws nor phantom-targets).
    const rel = new RelationshipModel(0.5);
    const ids = Array.from({ length: 6 }, (_, i) => npc(i + 1));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bond(rel, ids[i]!, ids[j]!, 0.9);
    const blocs = detectBlocs({ rel, active: ids }); // every active houseguest is in the one bloc
    expect(blocs).toHaveLength(1);
    expect(blocs[0]!.members).toHaveLength(6);
    expect(blocs[0]!.sharedTarget).toBeNull();                // no outsider ⇒ no shared enemy
    expect(blocTerm(blocs, ids[0]!, ids[1]!)).toBeLessThan(0); // still shields a mate, null target unmatched
  });
});

describe("loyalty (the ethereal↔static dial)", () => {
  it("is derived from disposition × soul state — a rattled loyalist dips, never stored", () => {
    expect(derivedLoyalty("bond", 0.5)).toBeGreaterThan(derivedLoyalty("clash", 0.5));
    expect(derivedLoyalty("bond", 0.1)).toBeLessThan(derivedLoyalty("bond", 0.5));
    expect(derivedLoyalty("bond", 0.9)).toBeGreaterThan(derivedLoyalty("bond", 0.5));
  });

  it("a bloc is as loyal as its flightiest member (weakest-weighted)", () => {
    const rel = new RelationshipModel(0.5);
    const [a, b, c] = trio(rel);
    const loyal = detectBlocs({ rel, active: [a!, b!, c!], loyaltyOf: () => 0.8 })[0]!;
    const mixed = detectBlocs({ rel, active: [a!, b!, c!], loyaltyOf: (id) => (id === c ? 0.45 : 0.8) })[0]!;
    expect(mixed.loyaltyStrength).toBeLessThan(loyal.loyaltyStrength);
    // The weak member drags the strength toward THEIR loyalty, not the average.
    expect(mixed.loyaltyStrength).toBeLessThan((0.8 + 0.8 + 0.45) / 3);
  });

  it("a low-loyalty member with a stronger MUTUAL outside bond defects off the bloc", () => {
    const rel = new RelationshipModel(0.5);
    // A clique {a,b,c} where c's weakest inside tie is small enough to be beaten by a mutual outside
    // bond, yet the inside edges are strong enough that c first clusters INTO the bloc (so the
    // DEFECTION pass — not re-clustering — is what removes c).
    const [a, b, c] = [npc(1), npc(2), npc(3)];
    bond(rel, a, b, 0.9); bond(rel, a, c, 0.9); bond(rel, b, c, 0.6);
    const tempter = npc(8);
    // SOC-NEW-2 (#563): the outside attraction must be MUTUAL (both directions) to peel a member off —
    // measured by the same `mutualBond` an inside tie is. A mutual c↔tempter of 0.75 beats c's weakest
    // inside tie (b↔c=0.6) by the margin. The tempter stays COOL toward a and b (below the bloc-edge
    // threshold), so it never clique-joins {a,b,c}; c clusters in first, then defects out.
    bond(rel, c, tempter, 0.75);
    bond(rel, a, tempter, 0.2); bond(rel, b, tempter, 0.2);
    const loyalties = (id: EntityId): number => (id === c ? 0.2 : 0.9);
    const blocs = detectBlocs({ rel, active: [a, b, c, tempter], loyaltyOf: loyalties });
    const bloc = blocFor(blocs, a);
    expect(bloc).toBeTruthy();
    expect(bloc!.members).not.toContain(c); // defected — and nothing stored existed to update
    // A HIGH-loyalty member under the same temptation stays.
    const stays = detectBlocs({ rel, active: [a, b, c, tempter], loyaltyOf: () => 0.9 });
    expect(blocFor(stays, a)!.members).toContain(c);
  });

  it("an UNREQUITED outside infatuation does NOT peel a member off (#563)", () => {
    const rel = new RelationshipModel(0.5);
    const [a, b, c] = trio(rel);
    const tempter = npc(8);
    // A ONE-WAY infatuation: c's pull outward is strong, but `tempter` does not reciprocate (the
    // reverse edge stays at the neutral default). A crush nobody returns is not a real outside tie, so
    // it must NOT defect c — even a low-loyalty member stays put when the temptation is unrequited.
    const e = rel.edge(c!, tempter); e.trust = 0.95; e.affinity = 0.95;
    const loyalties = (id: EntityId): number => (id === c ? 0.2 : 0.9);
    const blocs = detectBlocs({ rel, active: [a!, b!, c!, tempter], loyaltyOf: loyalties });
    expect(blocFor(blocs, a!)!.members).toContain(c); // no mutual outside tie ⇒ no defection
  });

  it("#585 — defection is two-phase: the result is independent of member iteration order", () => {
    // Two low-loyalty members of one cluster, each with a strong MUTUAL outside tie that beats their
    // weakest inside tie. Under the old in-pass mutation, an early defection changed the cluster a
    // later member was judged against (an order-dependent cascade). Two-phase decides both against the
    // same immutable snapshot, so the outcome must not depend on the order the active set is given.
    const build = (active: EntityId[]): RelationshipModel => {
      const rel = new RelationshipModel(0.5);
      const [a, b, c, d] = [npc(1), npc(2), npc(3), npc(4)];
      // A four-clique with c and d the weak links.
      bond(rel, a, b, 0.9); bond(rel, a, c, 0.9); bond(rel, a, d, 0.9);
      bond(rel, b, c, 0.9); bond(rel, b, d, 0.9); bond(rel, c, d, 0.6);
      // Each weak member has a mutual outside tie (to its own cool-toward-the-clique tempter) that
      // beats its weakest inside tie (c↔d=0.6) by the margin.
      const tc = npc(8), td = npc(9);
      bond(rel, c, tc, 0.75); bond(rel, a, tc, 0.2); bond(rel, b, tc, 0.2); bond(rel, d, tc, 0.2);
      bond(rel, d, td, 0.75); bond(rel, a, td, 0.2); bond(rel, b, td, 0.2); bond(rel, c, td, 0.2);
      void active;
      return rel;
    };
    const loyalties = (id: EntityId): number => (id === npc(3) || id === npc(4) ? 0.2 : 0.9);
    const orderA = [npc(1), npc(2), npc(3), npc(4), npc(8), npc(9)];
    const orderB = [npc(4), npc(3), npc(2), npc(1), npc(9), npc(8)];
    const membersOf = (active: EntityId[]): string =>
      JSON.stringify(detectBlocs({ rel: build(active), active, loyaltyOf: loyalties }).map((bl) => [...bl.members].sort()));
    expect(membersOf(orderA)).toBe(membersOf(orderB));
    // And concretely: BOTH weak members defect off the core {a,b}.
    const core = blocFor(detectBlocs({ rel: build(orderA), active: orderA, loyaltyOf: loyalties }), npc(1));
    expect(core!.members).not.toContain(npc(3));
    expect(core!.members).not.toContain(npc(4));
  });
});

describe("fracture + the 0002 invariant", () => {
  it("a betrayal that drops the bond yields a smaller bloc on the NEXT detection", () => {
    const rel = new RelationshipModel(0.5);
    const [a, b, c] = trio(rel);
    const before = detectBlocs({ rel, active: [a!, b!, c!] })[0]!;
    expect(before.members).toHaveLength(3);
    // A betrayal-shock (0026): the bond collapses below the threshold.
    for (let i = 0; i < 3; i++) rel.applyDirected(c!, a!, "betrayal", new SeededRandom(i + 1));
    for (let i = 0; i < 3; i++) rel.applyDirected(a!, c!, "betrayal", new SeededRandom(i + 9));
    const after = detectBlocs({ rel, active: [a!, b!, c!] });
    const blocOfA = blocFor(after, a!);
    expect(!blocOfA || blocOfA.members.length < 3).toBe(true); // smaller or split — nothing stored to update
  });

  it("nothing bloc-shaped is ever persisted (the serialized save is bloc-free)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("bloc-persist");
    sb.session.createCharacter({ playerName: "The Player", seed: 6 });
    // Engineer a live bloc, then snapshot.
    const ids = [npc(1), npc(2), npc(3)];
    for (const a of ids) for (const b of ids) if (a !== b) bond(sb.engine.relationships, a, b, 0.85);
    const blocs = detectBlocs({ rel: sb.engine.relationships, active: [PLAYER, ...ids, npc(4)] });
    expect(blocs.length).toBeGreaterThan(0);
    const snap = JSON.stringify(reg.snapshot("bloc-persist"));
    expect(snap).not.toMatch(/"bloc|"ally|"enemy|sharedTarget|loyaltyStrength|cohesion/);
  });
});

describe("the bloc term bends decisions (bounded, layered)", () => {
  it("shields bloc-mates, leans into the shared enemy, scaled by loyalty strength", () => {
    const rel = new RelationshipModel(0.5);
    const [a, b, c] = trio(rel);
    const enemy = npc(9);
    rel.edge(a!, enemy).threat = 0.9; rel.edge(b!, enemy).threat = 0.9; rel.edge(c!, enemy).threat = 0.9;
    const blocs = detectBlocs({ rel, active: [a!, b!, c!, enemy, npc(10)], loyaltyOf: () => 0.9 });
    expect(blocTerm(blocs, a!, b!)).toBeLessThan(0);        // shield
    expect(blocTerm(blocs, a!, enemy)).toBeGreaterThan(0);  // target the shared enemy
    expect(blocTerm(blocs, a!, npc(10))).toBe(0);           // neutral outsider
    expect(blocTerm(blocs, npc(10), b!)).toBe(0);           // a non-member carries no term
    const loose = detectBlocs({ rel, active: [a!, b!, c!, enemy, npc(10)], loyaltyOf: () => 0.45 });
    expect(Math.abs(blocTerm(loose, a!, b!))).toBeLessThan(Math.abs(blocTerm(blocs, a!, b!))); // loyalty scales it
  });

  it("LIVE: an engineered bloc votes together and is never nominated by its own HOH", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("bloc-live");
    const s = sb.session;
    s.createCharacter({ playerName: "The Player", seed: 12 });
    const rel = sb.engine.relationships;
    const blocIds = [npc(1), npc(2), npc(3)];
    for (let i = 0; i < 240; i++) {
      // Hold the engineered structure against the loop's own folds: an iron three-person bloc,
      // everyone else neutral. Their coordination must come from the DERIVED bloc, not luck.
      for (const a of blocIds) for (const b of blocIds) if (a !== b) {
        const e = rel.edge(a, b); e.trust = 0.95; e.affinity = 0.95; e.threat = 0;
      }
      const v = s.advanceGame();
      if (v.pending) {
        const p = v.pending;
        if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
        else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
        else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
      }
      // The proof: whenever a BLOC MEMBER is HOH, their nominations never include a bloc-mate.
      const status = s.gameStatus();
      if (status.hoh && blocIds.includes(status.hoh.id) && status.nominees.length === 2) {
        for (const nom of status.nominees) {
          expect(blocIds, `a bloc HOH nominated a bloc-mate`).not.toContain(nom.id);
        }
      }
      if (v.status.week >= 4 || v.finished) break;
    }
  });
});
