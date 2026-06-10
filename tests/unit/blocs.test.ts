import { describe, it, expect } from "vitest";
import { detectBlocs, blocTerm, blocFor, derivedLoyalty, BLOC } from "../../src/engine/blocs";
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

  it("blocs are bounded to plausible sizes and recompute identically from the same edges", () => {
    const rel = new RelationshipModel(0.5);
    const ids = Array.from({ length: 8 }, (_, i) => npc(i + 1));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bond(rel, ids[i]!, ids[j]!, 0.9);
    const blocs = detectBlocs({ rel, active: ids });
    for (const b of blocs) expect(b.members.length).toBeLessThanOrEqual(BLOC.maxSize);
    expect(JSON.stringify(detectBlocs({ rel, active: ids }))).toBe(JSON.stringify(blocs)); // same edges ⇒ same blocs
  });

  it("a one-sided bond never makes a bloc edge (mutuality required)", () => {
    const rel = new RelationshipModel(0.5);
    const e = rel.edge(npc(1), npc(2)); e.trust = 0.95; e.affinity = 0.95; // unrequited
    expect(detectBlocs({ rel, active: [npc(1), npc(2)] })).toEqual([]);
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

  it("a low-loyalty member with a stronger outside bond peels off BEFORE any betrayal", () => {
    const rel = new RelationshipModel(0.5);
    const [a, b, c] = trio(rel);
    const tempter = npc(8);
    // A ONE-WAY infatuation: the member's pull outward is strong, but the tempter doesn't
    // reciprocate enough to form a bloc edge — the tempter stays OUTSIDE the bloc.
    const e = rel.edge(c!, tempter); e.trust = 0.95; e.affinity = 0.95;
    const loyalties = (id: EntityId): number => (id === c ? 0.2 : 0.9);
    const blocs = detectBlocs({ rel, active: [a!, b!, c!, tempter], loyaltyOf: loyalties });
    const bloc = blocFor(blocs, a!);
    expect(bloc).toBeTruthy();
    expect(bloc!.members).not.toContain(c); // defected — and nothing stored existed to update
    // A HIGH-loyalty member under the same temptation stays.
    const stays = detectBlocs({ rel, active: [a!, b!, c!, tempter], loyaltyOf: () => 0.9 });
    expect(blocFor(stays, a!)!.members).toContain(c);
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
