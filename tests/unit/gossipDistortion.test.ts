import { describe, it, expect } from "vitest";
import { makeSocialGraph, diffuseGossip, rumorFrom } from "../../src/engine/gossip";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { npc } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * SG-6 (audit v2, social-game lane) — gossip diffusion must actually DISTORT, not just decay
 * confidence on an otherwise-verbatim copy. The design mandate (`docs/decisions/0002`, I3): a fact
 * that diffuses NPC-to-NPC across retellings reaches the player as a DISTORTED belief with a
 * source + confidence, not a faithful copy — "acting on a wrong version of events" must be possible.
 *
 * Before this fix, `distort()` only appended a cosmetic hedge suffix (" · supposedly#347") that was
 * stripped at display (`humanize.ts tidyPathwaySlugs`) — the underlying claim (who, with whom, what
 * nature) never changed across any number of hops. This suite proves the fix: past
 * `CONTENT_DRIFT_MIN_HOPS` (2) retellings, the claimed nature and/or subject pair can genuinely
 * drift (a seeded, bounded "telephone" effect), while a direct (1-hop) retelling stays faithful and
 * the Vault ground truth (`original`/`originalContent`) is never touched. Roles only (no fixture
 * names) — `npc(n)` ids, matching the existing gossip test convention.
 */

const SUBJECT_A = npc(1);
const SUBJECT_B = npc(2);
const TRUE_TYPE = "betrayal";
const TRUE_GLOSS = rumorFrom(SUBJECT_A, SUBJECT_B, TRUE_TYPE).split(" are ")[1]!;

/** A longer chain with a couple of side-branches (candidates for a subject swap). */
function chainGraph() {
  return makeSocialGraph([
    [npc(10), npc(11)], [npc(11), npc(12)], [npc(12), npc(13)], [npc(13), npc(14)],
    [npc(14), npc(15)], [npc(15), npc(16)], [npc(12), npc(20)], [npc(14), npc(21)],
  ]);
}

function run(seed: number, rounds: number) {
  const core = buildEngineCore();
  const graph = chainGraph();
  const { factId, original } = diffuseGossip({
    knowledge: core.knowledge,
    graph,
    rng: new SeededRandom(seed),
    origin: npc(10),
    fact: { content: rumorFrom(SUBJECT_A, SUBJECT_B, TRUE_TYPE) },
    rounds,
    transmitProb: 1,
    subjects: [SUBJECT_A, SUBJECT_B],
    sceneType: TRUE_TYPE,
  });
  const ids = [10, 11, 12, 13, 14, 15, 16, 20, 21].map((n) => npc(n));
  const beliefs = ids
    .map((id) => core.knowledge.knownTo(id).find((k) => k.factId === factId))
    .filter((b) => b !== undefined);
  return { core, factId, original, beliefs };
}

describe("SG-6 — gossip diffusion actually distorts across retellings", () => {
  it("a 1-hop retelling is minimally changed — the claimed nature is untouched", () => {
    const { beliefs, original } = run(2, 1);
    const hop1 = beliefs.filter((b) => (b!.hops ?? 0) === 1);
    expect(hop1.length).toBeGreaterThan(0);
    for (const b of hop1) {
      // Confidence decayed and a cosmetic hedge was appended, but the CLAIM (gloss) is unchanged.
      expect(b!.content).toContain(TRUE_GLOSS);
      expect(b!.confidence).toBeLessThan(1);
      // The hedge suffix is the only difference from the true rumor sentence.
      expect(b!.content.startsWith(original)).toBe(true);
    }
  });

  it("past the drift floor, the claim can genuinely become WRONG (nature and/or subject)", () => {
    // Seed 2 against this graph is a verified fixture: at least one belief 2+ hops from the origin
    // no longer carries the true gloss — the retelling chain has drifted the actual claim, not just
    // decayed its certainty. (Verified by direct probe against this exact seed/graph/rounds.)
    const { beliefs } = run(2, 6);
    const far = beliefs.filter((b) => (b!.hops ?? 0) >= 2);
    expect(far.length).toBeGreaterThan(0);
    const drifted = far.filter((b) => !b!.content.includes(TRUE_GLOSS));
    expect(drifted.length).toBeGreaterThan(0);
  });

  it("ground truth in the Vault is never touched by drift — only the diffusing belief distorts", () => {
    const { beliefs, original } = run(2, 6);
    // The origin's own belief (hops 0) is always the true, undistorted content.
    const originBelief = beliefs.find((b) => (b!.hops ?? 0) === 0)!;
    expect(originBelief.content).toBe(original);
    // Every belief, however drifted its displayed `content`, retains the TRUE original as provenance
    // — the 0048 unseal can always show how far a story warped from what actually happened.
    for (const b of beliefs) {
      expect((b as unknown as { originalContent?: string }).originalContent).toBe(original);
    }
  });

  it("confidence still decays monotonically with hops even while content drifts", () => {
    const { beliefs } = run(2, 6);
    const byHop = new Map<number, number>();
    for (const b of beliefs) {
      const h = b!.hops ?? 0;
      const c = b!.confidence ?? 1;
      if (!byHop.has(h) || byHop.get(h)! < c) byHop.set(h, c); // keep the max per hop-depth
    }
    const hops = [...byHop.keys()].sort((a, b) => a - b);
    for (let i = 1; i < hops.length; i++) {
      expect(byHop.get(hops[i])!).toBeLessThan(byHop.get(hops[i - 1])!);
    }
  });

  it("is fully deterministic — the same seed reproduces the same drift", () => {
    const a = run(2, 6).beliefs.map((b) => ({ hops: b!.hops, content: b!.content, confidence: b!.confidence }));
    const b = run(2, 6).beliefs.map((b) => ({ hops: b!.hops, content: b!.content, confidence: b!.confidence }));
    expect(a).toEqual(b);
  });

  it("without a sceneType (e.g. a position whisper), no claim-level drift is attempted", () => {
    // Callers that never asserted a nature/subject claim (houseSuspicion/seededTieSurfacing) keep
    // today's cosmetic-only hedge — there is no "claim" to become wrong.
    const core = buildEngineCore();
    const graph = chainGraph();
    const { factId, original } = diffuseGossip({
      knowledge: core.knowledge,
      graph,
      rng: new SeededRandom(2),
      origin: npc(10),
      fact: { content: "word in the house: two houseguests keep slipping off together" },
      rounds: 6,
      transmitProb: 1,
      // no subjects / sceneType
    });
    const ids = [10, 11, 12, 13, 14, 15, 16, 20, 21].map((n) => npc(n));
    const beliefs = ids
      .map((id) => core.knowledge.knownTo(id).find((k) => k.factId === factId))
      .filter((b) => b !== undefined);
    for (const b of beliefs) {
      // The prefix (the actual observable claim) is preserved verbatim; only the cosmetic hedge
      // (appended after " · ") differs hop to hop.
      expect(b!.content.split(" · ")[0]).toBe(original);
    }
  });
});
