import { describe, it, expect } from "vitest";
import { diffuseGossip, makeSocialGraph, rumorFrom, GOSSIP_HEARD } from "../../src/engine/gossip";
import { RelationshipModel } from "../../src/engine/relationships";
import { nominationScore } from "../../src/engine/season";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Audit E44 — gossip finally changes minds. Receiving a rumor folds a small, confidence-scaled
 * move toward its SUBJECTS into the listener's hidden relationship layer, so the decision systems
 * (noms/votes/saves/blocs — all of which read relationship edges) genuinely move on what travels.
 * HARD rule: roles only — subject, teller, listener, future HOH. No names.
 */

// Roles: the two subjects of the rumor, the origin (teller), and a listener who may become HOH.
const SUBJECT_A = npc(1);
const SUBJECT_B = npc(2);
const ORIGIN = npc(3);
const LISTENER = npc(4);

function run(deps: { withRel?: RelationshipModel; listener?: string; transmitProb?: number }) {
  const knowledge = buildEngineCore().knowledge;
  const listener = deps.listener ?? LISTENER;
  const graph = makeSocialGraph([[ORIGIN, listener]]);
  diffuseGossip({
    knowledge,
    graph,
    rng: new SeededRandom(11),
    origin: ORIGIN,
    fact: { content: rumorFrom(SUBJECT_A, SUBJECT_B, "betrayal") },
    rounds: 1,
    transmitProb: deps.transmitProb ?? 1,
    decay: 0.7,
    ...(deps.withRel ? { rel: deps.withRel, subjects: [SUBJECT_A, SUBJECT_B], sceneType: "betrayal" } : {}),
  });
  return knowledge;
}

describe("E44 — hearing a rumor moves the listener's read of its subjects", () => {
  it("a betrayal rumor raises the listener's threat read (and dents trust) toward both subjects", () => {
    const rel = new RelationshipModel(0.5);
    const beforeA = { ...rel.edge(LISTENER, SUBJECT_A) };
    const beforeB = { ...rel.edge(LISTENER, SUBJECT_B) };
    run({ withRel: rel });
    expect(rel.edge(LISTENER, SUBJECT_A).threat).toBeGreaterThan(beforeA.threat);
    expect(rel.edge(LISTENER, SUBJECT_B).threat).toBeGreaterThan(beforeB.threat);
    expect(rel.edge(LISTENER, SUBJECT_A).trust).toBeLessThan(beforeA.trust);
  });

  it("the fold is scoped: tellers' OWN edges and the subjects' edges toward others never move", () => {
    const rel = new RelationshipModel(0.5);
    const originBefore = { ...rel.edge(ORIGIN, SUBJECT_A) };
    const subjectBefore = { ...rel.edge(SUBJECT_A, LISTENER) };
    run({ withRel: rel });
    // The origin already KNOWS (they saw the scene) — receipt folds are for listeners only.
    expect(rel.edge(ORIGIN, SUBJECT_A)).toEqual(originBefore);
    // And the rumor moves reads OF the subjects, never the subjects' own beliefs.
    expect(rel.edge(SUBJECT_A, LISTENER)).toEqual(subjectBefore);
  });

  it("the PLAYER's edges are never gossip-folded — the human forms their own reads (ADR 0003)", () => {
    const rel = new RelationshipModel(0.5);
    const before = { ...rel.edge(PLAYER, SUBJECT_A) };
    run({ withRel: rel, listener: PLAYER });
    expect(rel.edge(PLAYER, SUBJECT_A)).toEqual(before);
  });

  it("without the rel seam (the pre-E44 call shape) no edge moves — pure diffusion is unchanged", () => {
    const rel = new RelationshipModel(0.5);
    const before = JSON.stringify(rel.serialize());
    run({}); // no rel passed
    expect(JSON.stringify(rel.serialize())).toBe(before);
  });

  it("a betrayal-rumor chain to a future HOH raises the subject's nomination danger vs the no-rumor control", () => {
    const seedHouse = (rel: RelationshipModel): void => {
      // The future HOH starts reading the subject and a peer identically — a true A/B control.
      for (const t of [SUBJECT_A, npc(9)]) {
        const e = rel.edge(LISTENER, t);
        e.threat = 0.4; e.trust = 0.3; e.affinity = 0.3;
      }
    };
    const withRumor = new RelationshipModel(0.5);
    const control = new RelationshipModel(0.5);
    seedHouse(withRumor);
    seedHouse(control);
    run({ withRel: withRumor });
    // Same seed, same reads — only the rumor differs. The subject now outranks the identical peer.
    const score = (rel: RelationshipModel, target: ReturnType<typeof npc>): number =>
      nominationScore(LISTENER, target, rel, 0.5);
    expect(score(withRumor, SUBJECT_A)).toBeGreaterThan(score(control, SUBJECT_A));
    expect(score(withRumor, SUBJECT_A)).toBeGreaterThan(score(withRumor, npc(9)));
  });

  it("every GOSSIP_HEARD magnitude is a bounded nudge, not a verdict (constants-module review gate)", () => {
    for (const impact of Object.values(GOSSIP_HEARD)) {
      for (const v of Object.values(impact)) expect(Math.abs(v as number)).toBeLessThanOrEqual(0.1);
    }
  });
});
