import { describe, it, expect } from "vitest";
import { runJuryHouseStretch, bearingWord } from "../../src/engine/juryHouse";
import { JURY_HOUSE, BEARING_THRESHOLDS, BEARING_MAX } from "../../src/engine/juryHouseConstants";
import { MANNER_LEAN } from "../../src/engine/juryConstants";
import { RelationshipModel } from "../../src/engine/relationships";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { EdgeSignals } from "../../src/engine/relationshipConstants";
import type { EvictionManner } from "../../src/engine/jury";

/**
 * Feature 0100 — the JURY HOUSE pure stretch. Roles only: a-finalist / a-betrayed-juror /
 * another-juror (close vs isolated) / a respected-juror. The stretch is engine-internal hidden
 * state; it records ONLY hidden juror↔juror scenes and computes a BOUNDED grudge adjustment.
 */

// The two finalists still in the game, plus a panel of jurors (the last-nine NPC evictees).
const FINALIST = npc(20);
const OTHER_FINALIST = npc(21);
const JURORS: EntityId[] = [npc(1), npc(2), npc(3), npc(4), npc(5), npc(6)];

/**
 * A jury-house society where the BETRAYED juror (npc 1) is closely bonded to a "close" juror (npc 2)
 * but isolated from an "isolated" juror (npc 6). Affinity drives who the grievance can travel to.
 */
function juryRel(closePair: [EntityId, EntityId], isolated: EntityId): RelationshipModel {
  const rel = new RelationshipModel(0.5);
  // Default: everyone mildly acquainted but below the gossip edge, so only the deliberate bonds carry.
  for (const a of JURORS) for (const b of JURORS) {
    if (a === b) continue;
    const e = rel.edge(a, b);
    e.affinity = 0.1; e.trust = 0.1; e.threat = 0.1; e.alignment = 0.1;
  }
  // The close pair are tight (well above the gossip affinity edge) in BOTH directions.
  for (const [a, b] of [closePair, [closePair[1], closePair[0]] as [EntityId, EntityId]]) {
    const e = rel.edge(a, b);
    e.affinity = 0.9; e.trust = 0.7; e.threat = 0.1; e.alignment = 0.4;
  }
  // Make the isolated juror genuinely cut off — no warm edge to anyone (already 0.1, but pin it low).
  for (const other of JURORS) {
    if (other === isolated) continue;
    rel.edge(isolated, other).affinity = 0.05;
    rel.edge(other, isolated).affinity = 0.05;
  }
  return rel;
}

function runStretch(
  rel: RelationshipModel,
  manner: Record<EntityId, Record<EntityId, EvictionManner>>,
  seed: number,
  events = new InMemoryEventStore(),
  knowledge = new InMemoryKnowledgeService(events),
): ReturnType<typeof runJuryHouseStretch> {
  return runJuryHouseStretch({
    events,
    rng: new SeededRandom(seed),
    knowledge,
    jurors: JURORS,
    edgeOf: (a, b) => rel.edge(a, b) as EdgeSignals,
    mannerOf: (juror, finalist) => manner[juror]?.[finalist] ?? {},
    finalists: [FINALIST, OTHER_FINALIST],
  });
}

describe("0100 — the jury house lives (hidden juror↔juror society)", () => {
  it("records hidden scenes among the jurors, never witnessed by the player", () => {
    const rel = juryRel([npc(1), npc(2)], npc(6));
    const events = new InMemoryEventStore();
    runStretch(rel, { [npc(1)]: { [FINALIST]: { betrayed: true } } }, 7, events);
    const recorded = events.queryAll();
    expect(recorded.length, "the jury house produced scenes").toBeGreaterThan(0);
    for (const ev of recorded) {
      expect(ev.hidden, "every jury-house scene is hidden").toBe(true);
      expect(ev.witnessSet, "the player is NEVER in a jury-house witness set").not.toContain(PLAYER);
      for (const w of ev.witnessSet) {
        expect(JURORS, "only jurors witness jury-house scenes").toContain(w);
      }
    }
  });

  it("the juror↔juror scenes carry more than one interaction nature (not a single canned verb)", () => {
    const rel = juryRel([npc(1), npc(2)], npc(6));
    // Accumulate scenes over several stretches with varied seeds so natures spread.
    const events = new InMemoryEventStore();
    const knowledge = new InMemoryKnowledgeService(events);
    for (let seed = 1; seed <= 8; seed++) {
      runStretch(rel, { [npc(1)]: { [FINALIST]: { betrayed: true } } }, seed, events, knowledge);
    }
    const natures = new Set(events.queryAll().filter((e) => e.type !== "conversation").map((e) => e.type));
    // richOffscreenStretch tags each scene with its real interaction nature; expect variety.
    const sceneTypes = new Set(events.queryAll().map((e) => e.type));
    expect(sceneTypes.size, `more than one scene nature (saw: ${[...sceneTypes].join(", ")})`).toBeGreaterThan(1);
    void natures;
  });
});

describe("0100 — bitterness is contagious, bounded, and only travels by pathway", () => {
  it("a betrayed juror's grievance sours a CLOSE juror (their hidden read of the finalist turns colder)", () => {
    const rel = juryRel([npc(1), npc(2)], npc(6)); // npc1 betrayed; npc2 close to npc1
    const manner = { [npc(1)]: { [FINALIST]: { betrayed: true } } };
    // Accumulate over several sequester stretches so the grievance diffuses and the grudge builds.
    const events = new InMemoryEventStore();
    const knowledge = new InMemoryKnowledgeService(events);
    const grudge = new Map<string, number>();
    for (let seed = 1; seed <= 12; seed++) {
      const res = runStretch(rel, manner, seed, events, knowledge);
      for (const g of res.grudges) {
        const key = `${g.juror}->${g.finalist}`;
        grudge.set(key, Math.min(JURY_HOUSE.adjustmentCap, (grudge.get(key) ?? 0) + g.delta));
      }
    }
    const closeGrudge = grudge.get(`${npc(2)}->${FINALIST}`) ?? 0;
    expect(closeGrudge, "the close juror's grudge toward the finalist grew").toBeGreaterThan(0);
    // The shift is confidence-scaled + capped (saturation): it can never exceed the cap.
    expect(closeGrudge, "the grudge stays within the saturation bound").toBeLessThanOrEqual(JURY_HOUSE.adjustmentCap);
  });

  it("a juror with NO pathway to the grievance is unmoved (the omniscience ban)", () => {
    const rel = juryRel([npc(1), npc(2)], npc(6)); // npc6 is isolated from the betrayed npc1
    const manner = { [npc(1)]: { [FINALIST]: { betrayed: true } } };
    const events = new InMemoryEventStore();
    const knowledge = new InMemoryKnowledgeService(events);
    let isolatedGotGrudge = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const res = runStretch(rel, manner, seed, events, knowledge);
      isolatedGotGrudge += res.grudges.filter((g) => g.juror === npc(6)).length;
    }
    expect(isolatedGotGrudge, "an isolated juror never picks up a grudge with no pathway to it").toBe(0);
  });

  it("a juror who carries NO grievance produces no contagion at all", () => {
    const rel = juryRel([npc(1), npc(2)], npc(6));
    // No grievance recorded anywhere ⇒ nothing to diffuse ⇒ no grudge from any juror.
    const res = runStretch(rel, {}, 3);
    expect(res.grudges, "no grievance ⇒ no grudge").toHaveLength(0);
  });

  it("the PLAYER is a SUBJECT only — no jury-house pathway ever terminates at the player", () => {
    // The player is not a node in the jury-house graph (only jurors are), so however hard the grievance
    // diffuses, the player's knowledge is NEVER updated by it (the Vault Wall, by construction).
    const rel = juryRel([npc(1), npc(2)], npc(6));
    const manner = { [npc(1)]: { [FINALIST]: { betrayed: true } } };
    const events = new InMemoryEventStore();
    const knowledge = new InMemoryKnowledgeService(events);
    for (let seed = 1; seed <= 12; seed++) runStretch(rel, manner, seed, events, knowledge);
    expect(knowledge.knownTo(PLAYER), "the player learns NOTHING from the jury house").toHaveLength(0);
    // Nor does any jury-house event (scene or telling) ever list the player in its witness set.
    for (const ev of events.queryAll()) {
      expect(ev.witnessSet, "no jury-house event ever witnesses the player").not.toContain(PLAYER);
    }
  });
});

describe("0100 — the grudge is sized as TEXTURE, under the manner lean (the 0086 ruling-#1 discipline)", () => {
  it("the saturation cap is strictly UNDER a full betrayal manner's magnitude", () => {
    // A fully-saturated grudge (the cap) must move the lean by LESS than a single recorded grievance —
    // it deepens the eviction-manner baseline, it never becomes a second flat knob that swamps it.
    expect(JURY_HOUSE.adjustmentCap).toBeLessThan(Math.abs(MANNER_LEAN.betrayed));
    expect(JURY_HOUSE.adjustmentCap).toBeLessThan(Math.abs(MANNER_LEAN.blindsided));
  });

  it("the per-hop increment is positive and bounded", () => {
    expect(JURY_HOUSE.grudgePerHop).toBeGreaterThan(0);
    expect(JURY_HOUSE.grudgePerHop).toBeLessThan(JURY_HOUSE.adjustmentCap);
  });
});

describe("0100 — the jury house is deterministic", () => {
  it("same seed + same history ⇒ identical scenes and grudges", () => {
    const rel1 = juryRel([npc(1), npc(2)], npc(6));
    const rel2 = juryRel([npc(1), npc(2)], npc(6));
    const manner = { [npc(1)]: { [FINALIST]: { betrayed: true } } };
    const a = runStretch(rel1, manner, 42);
    const b = runStretch(rel2, manner, 42);
    expect(b.scenes.map((s) => `${s.initiator}|${s.partner}|${s.type}`))
      .toEqual(a.scenes.map((s) => `${s.initiator}|${s.partner}|${s.type}`));
    expect(b.grudges).toEqual(a.grudges);
  });

  it("fewer than two jurors ⇒ no society, no grudge (no-op)", () => {
    const rel = new RelationshipModel(0.5);
    const events = new InMemoryEventStore();
    const res = runJuryHouseStretch({
      events,
      rng: new SeededRandom(1),
      knowledge: new InMemoryKnowledgeService(events),
      jurors: [npc(1)],
      edgeOf: (a, b) => rel.edge(a, b) as EdgeSignals,
      mannerOf: () => ({ betrayed: true }),
      finalists: [FINALIST],
    });
    expect(res.scenes).toHaveLength(0);
    expect(res.grudges).toHaveLength(0);
    expect(events.queryAll()).toHaveLength(0);
  });
});


describe("#1790 — bearingWord (pure bearing-word mapper)", () => {
  it.each([
    // settled: [0, 0.02)
    [0,     'settled'],
    [0.01,  'settled'],
    // cold: [0.02, 0.07)
    [0.02,  'cold'],
    [0.06,  'cold'],
    // warm: [0.07, 0.13)
    [0.07,  'warm'],
    [0.12,  'warm'],
    // burning: >= 0.13
    [0.13,  'burning'],
    [0.18,  'burning'],
    // negative clamps to settled
    [-1,   'settled'],
    [-0.5, 'settled'],
    // above cap clamps to burning
    [1,    'burning'],
  ])("grudge %d maps to %s", (grudge, expected) => {
    expect(bearingWord(grudge)).toBe(expected);
  });

  it("never returns a number", () => {
    const result = bearingWord(0.1);
    expect(typeof result).toBe("string");
    expect(Number.isNaN(Number(result))).toBe(true);
  });
});
