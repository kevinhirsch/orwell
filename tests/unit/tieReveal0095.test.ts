import { describe, it, expect } from "vitest";
import { overhearTieReveal } from "../../src/engine/tieReveal";
import { TIE_REVEAL } from "../../src/engine/tieRevealConstants";
import { tieExposureOf, tieNatureProse, type PreGameTie } from "../../src/engine/seededRelationships";
import { RelationshipModel } from "../../src/engine/relationships";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0095 — the pure OVERHEAR reveal pathway. A SEPARATE, distinct module from 0059 §5's
 * `seededTieSurfacing.ts` (which is deliberately vague and folds nothing but a mild third-party
 * re-read). This module reveals the REAL pre-show connection and folds a genuine, confidence-scaled
 * betrayal-grade belief. Roles only. Vault-free by construction: the mechanism decides to expose
 * BEFORE any content ever crosses.
 */

const NPCS = [npc(1), npc(2), npc(3), npc(4)];
const tie: PreGameTie = { a: npc(1), b: npc(2), nature: "old-acquaintance" };
const warm = (a: EntityId, b: EntityId): number => (a === b ? 0 : 0.9); // well above conspicuousAffinity

function freshKnowledge(): InMemoryKnowledgeService {
  return new InMemoryKnowledgeService(new InMemoryEventStore());
}

function baseDeps(overrides: Partial<Parameters<typeof overhearTieReveal>[0]> = {}) {
  return {
    ties: [tie],
    npcs: NPCS,
    player: PLAYER,
    affinity: warm,
    nameOf: (id: EntityId) => `HG-${id}`,
    natureProse: (t: PreGameTie) => tieNatureProse(t.nature),
    knowledge: freshKnowledge(),
    rel: new RelationshipModel(0.5),
    exposureCount: 0,
    rng: new SeededRandom(1),
    ...overrides,
  };
}

describe("0095 overhearTieReveal — no leak before a pathway fires", () => {
  it("no observable tie ⇒ nothing rises", () => {
    const cold = (a: EntityId, b: EntityId): number => (a === b ? 0 : 0.1); // never conspicuous
    const out = overhearTieReveal(baseDeps({ affinity: cold }));
    expect(out).toEqual([]);
  });

  it("a tie already at `public` is never a candidate again", () => {
    const publicTie: PreGameTie = { ...tie, exposure: "public" };
    const out = overhearTieReveal(baseDeps({ ties: [publicTie] }));
    expect(out).toEqual([]);
  });

  it("the season cap refuses further exposure once spent", () => {
    const out = overhearTieReveal(baseDeps({ exposureCount: TIE_REVEAL.maxExposuresPerSeason }));
    expect(out).toEqual([]);
  });

  it("no observer positioned (everyone behind closed doors) ⇒ nothing rises", () => {
    const occupancy = new Map<EntityId, string>([[npc(3), "hoh room"], [npc(4), "bedroom a"]]) as never;
    const out = overhearTieReveal(baseDeps({ occupancy }));
    expect(out).toEqual([]);
  });
});

describe("0095 overhearTieReveal — a pathway exposes the tie and folds the fallout", () => {
  it("finds a firing seed, promotes sealed → surfaced-to-house, and folds the direct-witness blow", () => {
    let fired = false;
    for (let seed = 0; seed < 500 && !fired; seed++) {
      const rel = new RelationshipModel(0.5);
      const before = { ...rel.edge(npc(3), npc(1)) };
      const out = overhearTieReveal(baseDeps({ rng: new SeededRandom(seed), rel }));
      if (out.length === 0) continue;
      fired = true;
      const ev = out[0]!;
      expect(ev.pair.includes(npc(1))).toBe(true);
      expect(ev.pair.includes(npc(2))).toBe(true);
      expect(ev.exposure).toBe("surfaced-to-house");
      expect(ev.firstExposure).toBe(true);
      expect(tieExposureOf({ exposure: ev.exposure })).toBe("surfaced-to-house");
      // The observer's OWN read of a pair member moved (a betrayal-grade blow, not a no-op).
      const after = rel.edge(ev.observer, npc(1));
      expect(after.trust !== before.trust || after.threat !== before.threat).toBe(true);
    }
    expect(fired, "at least one of 500 seeds should fire the (bounded-probability) overhear pathway").toBe(true);
  });

  it("a SECOND spark on an already surfaced-to-house tie promotes it to public", () => {
    const surfaced: PreGameTie = { ...tie, exposure: "surfaced-to-house" };
    let fired = false;
    for (let seed = 0; seed < 500 && !fired; seed++) {
      const out = overhearTieReveal(baseDeps({ ties: [surfaced], rng: new SeededRandom(seed) }));
      if (out.length === 0) continue;
      fired = true;
      expect(out[0]!.exposure).toBe("public");
      expect(out[0]!.firstExposure).toBe(false); // it was already exposed — doesn't re-spend the cap
    }
    expect(fired).toBe(true);
  });

  it("never fires more than one event per call (trickles, never bursts)", () => {
    for (let seed = 0; seed < 100; seed++) {
      const out = overhearTieReveal(baseDeps({ rng: new SeededRandom(seed) }));
      expect(out.length).toBeLessThanOrEqual(1);
    }
  });

  it("the diffused content carries the REAL nature prose once the engine has decided to expose it", () => {
    let content: string | undefined;
    for (let seed = 0; seed < 500 && !content; seed++) {
      const knowledge = freshKnowledge();
      const out = overhearTieReveal(baseDeps({ rng: new SeededRandom(seed), knowledge }));
      if (out.length === 0) continue;
      const held = knowledge.knownTo(out[0]!.observer);
      content = held.find((f) => f.content.includes("word is out"))?.content;
    }
    expect(content).toBeDefined();
    expect(content).toContain(tieNatureProse(tie.nature));
  });
});

describe("0095 overhearTieReveal — deterministic", () => {
  it("same seed + same deps ⇒ the same event", () => {
    const run = (): unknown => overhearTieReveal(baseDeps({ rng: new SeededRandom(7) }));
    expect(run()).toEqual(run());
  });
});
