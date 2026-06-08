import type { KnowledgeService } from "../ports/KnowledgeService";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EntityId } from "../domain/ids";

/**
 * The social graph gossip travels along. Minimal here (undirected adjacency); the
 * organic, graded relationship model (decision 0002) refines edge selection later.
 */
export interface SocialGraph {
  nodes(): EntityId[];
  neighbors(id: EntityId): EntityId[];
}

export function makeSocialGraph(edges: ReadonlyArray<readonly [EntityId, EntityId]>): SocialGraph {
  const adj = new Map<EntityId, Set<EntityId>>();
  const link = (a: EntityId, b: EntityId): void => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const [a, b] of edges) {
    link(a, b);
    link(b, a);
  }
  return {
    nodes: () => [...adj.keys()],
    neighbors: (id) => [...(adj.get(id) ?? [])],
  };
}

/** Each retelling drifts the message — that's how second-hand facts become wrong. */
function distort(content: string, rng: RandomnessSource): string {
  const drift = ["roughly", "or so I heard", "supposedly", "more or less", "the way I heard it"];
  return `${content} · ${rng.pick(drift)}#${rng.int(1000)}`;
}

/**
 * Diffuse a hidden fact NPC-to-NPC across the social graph, one hop per round.
 * Every retelling is recorded as its own event (via `transmitGossip`), each
 * recipient holds the fact as a belief with provenance + confidence (decaying
 * with hops) + distortion (growing with hops). It reaches the player only if a
 * chain of tellings terminates at the player. Deterministic under a fixed seed.
 */
export function diffuseGossip(deps: {
  knowledge: KnowledgeService;
  graph: SocialGraph;
  rng: RandomnessSource;
  origin: EntityId;
  fact: { content: string };
  rounds: number;
  transmitProb?: number;
  decay?: number;
}): { factId: string; original: string } {
  const { knowledge, graph, rng, origin, fact, rounds } = deps;
  const transmitProb = deps.transmitProb ?? 0.8;
  const decay = deps.decay ?? 0.7;
  const factId = `fact:${origin}:${rng.int(1_000_000)}`;
  const original = fact.content;

  knowledge.seedBelief(
    origin,
    { content: original, originalContent: original, factId, confidence: 1, hops: 0, distortion: 0, source: origin },
    "origin",
  );

  const holds = (e: EntityId): boolean => knowledge.knownTo(e).some((k) => k.factId === factId);
  const beliefOf = (e: EntityId): KnowledgeFactLike | undefined =>
    knowledge.knownTo(e).find((k) => k.factId === factId);

  for (let r = 0; r < rounds; r++) {
    const holders = graph.nodes().filter(holds); // snapshot: one hop per round
    for (const from of holders) {
      const belief = beliefOf(from)!;
      for (const to of graph.neighbors(from)) {
        if (holds(to)) continue;
        if (rng.next() >= transmitProb) continue;
        const hops = (belief.hops ?? 0) + 1;
        knowledge.transmitGossip(
          from,
          to,
          {
            content: distort(belief.content, rng),
            originalContent: original,
            factId,
            confidence: (belief.confidence ?? 1) * decay,
            source: from,
            hops,
            // hops + fractional noise → strictly ordered by hops, with per-telling variance.
            distortion: hops + rng.next(),
          },
          `told-by:${from}`,
        );
      }
    }
  }

  return { factId, original };
}

type KnowledgeFactLike = { hops?: number; confidence?: number; content: string };
