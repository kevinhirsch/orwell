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

/**
 * Live-diffusion tunables (B27b — the 0028 constants pattern). A rumor RISES from a scene only
 * occasionally, travels with a LOW transmit probability over the affinity graph, and decays —
 * partial, distorted spread that reaches the player rarely, as a belief with source+confidence.
 * Volume is also a cost bound: every retelling is a recorded event (the B54/UAT lesson).
 */
export const GOSSIP = {
  /** Chance per off-screen tick that one of the night's scenes becomes a rumor. */
  riseProb: 0.15,
  /** Per-edge chance a holder retells the rumor each round. */
  transmitProb: 0.25,
  /** Diffusion rounds per rumor (one hop per round). */
  rounds: 2,
  /** Confidence decay per hop. */
  decay: 0.7,
  /** Affinity above this makes a social-graph edge (who actually talks to whom). */
  affinityEdge: 0.35,
} as const;

/** The vague gloss a scene's nature gets when it becomes a rumor — NEVER the verbatim scene. */
export const RUMOR_GLOSS: Record<string, string> = {
  alliance: "getting awfully close",
  gossip: "talking about everyone behind their backs",
  conflict: "at each other's throats",
  bonding: "thick as thieves lately",
  strategy: "plotting something",
  showmance: "more than friends",
  betrayal: "about to turn on someone",
};

/**
 * The rumor a hidden scene gives rise to (B27b): a vague PARAPHRASE of who-with-whom and the vibe —
 * never the verbatim hidden content, so the 0031 leak sweep can stay strict about exact strings.
 */
export function rumorFrom(initiator: EntityId, partner: EntityId, type: string): string {
  return `word around the house is that ${initiator} and ${partner} are ${RUMOR_GLOSS[type] ?? "up to something"}`;
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
