import { describe, it, expect } from "vitest";
import { makeSocialGraph, diffuseGossip, gossipEdgeAffinity, GOSSIP } from "../../src/engine/gossip";
import { RelationshipModel } from "../../src/engine/relationships";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * Issue #565 (SOC-NEW-3) — the PLAYER must be able to TERMINATE a rumor-diffusion chain on the
 * strength of how warmly NPCs feel about THEM (the inbound NPC→player edge), not only on their own
 * outbound bonds. The orchestrator builds the rumor graph with the player at `everyone[0]`, so the
 * directed-only `edge(everyone[i], everyone[j]).affinity` test only ever read the player→NPC
 * direction — until the player built ≥ 0.35 OUTBOUND affinity they had ZERO edges in the graph and
 * could never hear gossip, no matter how much NPCs gossiped about them. The fix makes edge
 * selection symmetric (`gossipEdgeAffinity` = max of both directions), consistent with the already
 * undirected adjacency `makeSocialGraph` builds. Roles only — no houseguest names.
 *
 * The diffusion still runs entirely in the hidden layer; the player's knowledge changes ONLY when a
 * pathway actually terminates at them (the assertions below read `knownTo(player)` — a real,
 * traceable `told-by:` pathway — never a Vault handle). The Vault Wall is untouched.
 */

/** Rebuild the orchestrator's player-at-index-0 edge loop under a chosen edge metric. */
function buildEdges(
  rel: RelationshipModel,
  ids: readonly EntityId[],
  metric: (a: EntityId, b: EntityId) => number,
): Array<readonly [EntityId, EntityId]> {
  const everyone: EntityId[] = [PLAYER, ...ids]; // PLAYER is everyone[0], exactly as the orchestrator
  const edges: Array<readonly [EntityId, EntityId]> = [];
  for (let i = 0; i < everyone.length; i++) {
    for (let j = i + 1; j < everyone.length; j++) {
      if (metric(everyone[i]!, everyone[j]!) > GOSSIP.affinityEdge) edges.push([everyone[i]!, everyone[j]!] as const);
    }
  }
  return edges;
}

/** The OLD directed-only metric (the bug): a→b only, so player edges only ever test player→NPC. */
const directedOnly = (rel: RelationshipModel) => (a: EntityId, b: EntityId): number => rel.edge(a, b).affinity;

/**
 * Seed a house where ONE NPC is warm TOWARD the player (NPC→player high) and is also the player's
 * only well-connected gossip neighbor, while the player makes NO high-OUTBOUND bonds (every
 * player→NPC edge stays at/under threshold). The classic dramatic-irony setup: the house is talking
 * about the player's circle, an ally would happily pass it on — but the strategically-detached
 * player built no outbound warmth.
 */
function seedHouse(): { rel: RelationshipModel; ids: EntityId[]; talker: EntityId } {
  const rel = new RelationshipModel(0.5);
  const ids = [npc(1), npc(2), npc(3)];
  const talker = npc(1); // the NPC who is warm toward the player AND originates the rumor
  // talker → player is WARM (well above 0.35): the ally would carry a rumor to the player.
  rel.edge(talker, PLAYER).affinity = 0.8;
  // player → talker stays at the cold baseline: the player built no outbound bond.
  rel.edge(PLAYER, talker).affinity = 0.2;
  // A warm NPC↔NPC backbone so the rumor actually spreads before reaching the player's edge.
  rel.edge(npc(1), npc(2)).affinity = 0.8;
  rel.edge(npc(2), npc(1)).affinity = 0.8;
  rel.edge(npc(2), npc(3)).affinity = 0.8;
  rel.edge(npc(3), npc(2)).affinity = 0.8;
  return { rel, ids, talker };
}

/** Diffuse a rumor over `edges` and report whether ANY belief landed on the player. */
function rumorReachesPlayer(edges: Array<readonly [EntityId, EntityId]>, origin: EntityId, seed: number): boolean {
  const core = buildEngineCore();
  if (edges.length === 0) return false; // the orchestrator skips diffusion entirely with no edges
  const { factId } = diffuseGossip({
    knowledge: core.knowledge,
    graph: makeSocialGraph(edges),
    rng: new SeededRandom(seed),
    origin,
    fact: { content: "a hidden scene" },
    rounds: GOSSIP.rounds,
    transmitProb: 1, // force transmission so the test asserts REACHABILITY, not the rare-rise dice
  });
  return core.knowledge.knownTo(PLAYER).some((k) => k.factId === factId);
}

describe("issue #565 — the player joins the rumor graph by INBOUND (NPC→player) affinity", () => {
  it("gossipEdgeAffinity is the max of both directed reads (symmetric edge selection)", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(npc(1), PLAYER).affinity = 0.8; // warm toward the player
    rel.edge(PLAYER, npc(1)).affinity = 0.1; // cold from the player
    expect(rel.edge(PLAYER, npc(1)).affinity).toBeLessThanOrEqual(GOSSIP.affinityEdge);
    expect(gossipEdgeAffinity(rel, PLAYER, npc(1))).toBeCloseTo(0.8);
    expect(gossipEdgeAffinity(rel, npc(1), PLAYER)).toBeCloseTo(0.8); // order-independent
    expect(gossipEdgeAffinity(rel, PLAYER, npc(1))).toBeGreaterThan(GOSSIP.affinityEdge);
  });

  it("FALSIFIER: under the OLD directed-only rule the player gets ZERO edges and never hears it", () => {
    const { rel, ids } = seedHouse();
    const edges = buildEdges(rel, ids, directedOnly(rel));
    // The player is structurally absent from the graph — the bug.
    expect(edges.some((e) => e[0] === PLAYER || e[1] === PLAYER)).toBe(false);
  });

  it("FIX: under symmetric selection the warm NPC→player edge enters the graph", () => {
    const { rel, ids } = seedHouse();
    const edges = buildEdges(rel, ids, (a, b) => gossipEdgeAffinity(rel, a, b));
    expect(edges.some((e) => e[0] === PLAYER || e[1] === PLAYER)).toBe(true);
  });

  it("a belief CAN now land on the player though they made no high-outbound bonds", () => {
    const { rel, ids, talker } = seedHouse();
    const oldEdges = buildEdges(rel, ids, directedOnly(rel));
    const newEdges = buildEdges(rel, ids, (a, b) => gossipEdgeAffinity(rel, a, b));

    // Currently (OLD rule) the rumor can NEVER reach the player, across every seed.
    for (let seed = 1; seed <= 25; seed++) {
      expect(rumorReachesPlayer(oldEdges, talker, seed)).toBe(false);
    }
    // With the FIX a chain CAN terminate at the player on the inbound edge (≥ 1 seed across the run).
    const everReaches = Array.from({ length: 25 }, (_, k) => rumorReachesPlayer(newEdges, talker, k + 1));
    expect(everReaches.some((r) => r)).toBe(true);
  });

  it("what lands is a hidden-layer belief reached through a real traceable pathway (Vault Wall intact)", () => {
    const { rel, ids, talker } = seedHouse();
    const newEdges = buildEdges(rel, ids, (a, b) => gossipEdgeAffinity(rel, a, b));
    // Find a seed where it reaches, then inspect HOW it reached.
    let landed: { core: ReturnType<typeof buildEngineCore>; factId: string } | null = null;
    for (let seed = 1; seed <= 60 && !landed; seed++) {
      const core = buildEngineCore();
      const { factId } = diffuseGossip({
        knowledge: core.knowledge, graph: makeSocialGraph(newEdges), rng: new SeededRandom(seed),
        origin: talker, fact: { content: "a hidden scene" }, rounds: GOSSIP.rounds, transmitProb: 1,
      });
      if (core.knowledge.knownTo(PLAYER).some((k) => k.factId === factId)) landed = { core, factId };
    }
    expect(landed, "expected at least one seed in [1,60] to terminate at the player").not.toBeNull();
    const belief = landed!.core.knowledge.knownTo(PLAYER).find((k) => k.factId === landed!.factId)!;
    // A real, traceable in-game pathway (a telling) — never an out-of-band reveal.
    expect(belief.pathway).toMatch(/^told-by:/);
    // It arrived as a HOP-distant, lower-confidence belief — a distorted whisper, not ground truth.
    expect(belief.hops ?? 0).toBeGreaterThanOrEqual(1);
    expect(belief.confidence ?? 1).toBeLessThan(1);
  });
});
