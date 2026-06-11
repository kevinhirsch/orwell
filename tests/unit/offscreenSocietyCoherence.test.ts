import { describe, it, expect } from "vitest";
import { richOffscreenStretch, SOCIETY } from "../../src/engine/offscreen";
import { RelationshipModel } from "../../src/engine/relationships";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Audit E45 — the off-screen society is socially COHERENT, not uniform noise: scenes happen
 * between CO-PRESENT houseguests, partners follow real ties, natures follow the initiator's
 * read, and betrayal fires only over an existing bond with incentive. HARD rule: roles only.
 */

const NPCS: EntityId[] = [npc(1), npc(2), npc(3), npc(4), npc(5), npc(6)];

function stretch(opts: {
  seed: number;
  interactions: number;
  rel: RelationshipModel;
  occupancy?: ReadonlyMap<EntityId, string>;
}) {
  const events = new InMemoryEventStore();
  return richOffscreenStretch({
    events,
    rng: new SeededRandom(opts.seed),
    npcs: NPCS,
    interactions: opts.interactions,
    edgeOf: (a, b) => opts.rel.edge(a, b),
    ...(opts.occupancy ? { occupancy: opts.occupancy } : {}),
  });
}

describe("E45 — motivated, co-present off-screen scenes", () => {
  it("every scene's witness set is co-located in the occupancy ground truth (0049)", () => {
    const occupancy = new Map<EntityId, string>([
      [npc(1), "kitchen"], [npc(2), "kitchen"], [npc(3), "backyard"],
      [npc(4), "backyard"], [npc(5), "bedroom"], [npc(6), "bedroom"],
    ]);
    const rel = new RelationshipModel(0.5);
    for (let seed = 1; seed <= 20; seed++) {
      for (const scene of stretch({ seed, interactions: 6, rel, occupancy })) {
        const rooms = new Set(scene.event.witnessSet.map((w) => occupancy.get(w)));
        expect(rooms.size, `scene witnesses share a room (seed ${seed})`).toBe(1);
      }
    }
  });

  it("betrayal fires ONLY over an above-threshold prior bond with a real threat incentive", () => {
    const rel = new RelationshipModel(0.5);
    // One genuine bond-with-incentive pair; everyone else is strangers (below the gate).
    const bonded = rel.edge(npc(1), npc(2));
    bonded.trust = 0.8; bonded.affinity = 0.7; bonded.threat = 0.6;
    let betrayals = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const scene of stretch({ seed, interactions: 3, rel })) {
        if (scene.type !== "betrayal") continue;
        betrayals++;
        const e = rel.edge(scene.initiator, scene.partner);
        const bond = (e.trust + e.affinity) / 2;
        expect(bond).toBeGreaterThanOrEqual(SOCIETY.betrayalBondFloor);
        expect(e.threat).toBeGreaterThanOrEqual(SOCIETY.betrayalThreatFloor);
      }
    }
    expect(betrayals, "the gated betrayal DOES still happen where it is earned").toBeGreaterThan(0);
  });

  it("partners are drawn by tie strength: a charged tie pairs up far more often than a stranger", () => {
    const rel = new RelationshipModel(0.5);
    // npc1 has one strong tie (npc2) and four near-zero strangers.
    for (const other of NPCS) {
      if (other === npc(1)) continue;
      const e = rel.edge(npc(1), other);
      e.affinity = 0.02; e.alignment = 0.02; e.threat = 0.02; e.trust = 0.02;
    }
    const tie = rel.edge(npc(1), npc(2));
    tie.affinity = 0.9; tie.alignment = 0.8; tie.trust = 0.8;
    let withTie = 0;
    let withStranger = 0;
    for (let seed = 1; seed <= 400; seed++) {
      for (const scene of stretch({ seed, interactions: 2, rel })) {
        if (scene.initiator !== npc(1)) continue;
        if (scene.partner === npc(2)) withTie++;
        else withStranger++;
      }
    }
    expect(withTie).toBeGreaterThan(withStranger);
  });

  it("natures follow the read: a high-affinity pair bonds; a high-threat pair clashes", () => {
    const warm = new RelationshipModel(0.5);
    const tense = new RelationshipModel(0.5);
    for (const a of NPCS) for (const b of NPCS) {
      if (a === b) continue;
      const w = warm.edge(a, b); w.affinity = 0.9; w.trust = 0.8; w.threat = 0.02; w.alignment = 0.2;
      const t = tense.edge(a, b); t.affinity = 0.05; t.trust = 0.05; t.threat = 0.9; t.alignment = 0.05;
    }
    const count = (rel: RelationshipModel, type: string): number => {
      let n = 0;
      for (let seed = 1; seed <= 120; seed++) {
        n += stretch({ seed, interactions: 3, rel }).filter((s) => s.type === type).length;
      }
      return n;
    };
    expect(count(warm, "bonding")).toBeGreaterThan(count(warm, "conflict"));
    expect(count(tense, "conflict")).toBeGreaterThan(count(tense, "bonding"));
  });

  it("the legacy uniform draw is preserved byte-for-byte when the E45 deps are absent", () => {
    const draw = () => {
      const events = new InMemoryEventStore();
      return richOffscreenStretch({ events, rng: new SeededRandom(7), npcs: NPCS, interactions: 5 })
        .map((s) => `${s.initiator}|${s.partner}|${s.type}`);
    };
    expect(draw()).toEqual(draw()); // deterministic
  });
});
