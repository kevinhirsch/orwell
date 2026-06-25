import type { KnowledgeService } from "../ports/KnowledgeService";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EntityId } from "../domain/ids";
import { PLAYER } from "../domain/ids";
import { scaleImpact } from "./relationshipConstants";
import type { EdgeSignals } from "./relationshipConstants";
import type { RelationshipModel } from "./relationships";

/**
 * The social graph gossip travels along. Minimal here (undirected adjacency); the
 * organic, graded relationship model (decision 0002) refines edge selection later.
 */
export interface SocialGraph {
  nodes(): EntityId[];
  neighbors(id: EntityId): EntityId[];
}

/**
 * The undirected affinity for a candidate social-graph edge a↔b: the MAX of the two directed
 * reads (issue #565). The social graph is undirected (`makeSocialGraph` symmetrizes adjacency),
 * so edge SELECTION must be symmetric too — a rumor can travel along a bond whenever EITHER party
 * is warm enough toward the other to carry it. The directed-only `edge(a,b).affinity` test (a→b
 * only) structurally excluded the PLAYER (always built as `everyone[0]`, so only player→NPC was
 * ever read) from the graph until their OWN outbound affinity crossed the threshold — so however
 * warmly NPCs felt about them, a diffusion chain could never terminate at the player and the
 * dramatic irony ran backwards. Reads only the GRADED relationship signals (decision 0002); the
 * diffusion stays in the hidden layer and the player's knowledge updates only when a pathway
 * actually terminates at them (the Vault Wall is unchanged — no Vault handle crosses here).
 */
export function gossipEdgeAffinity(rel: { edge(a: EntityId, b: EntityId): EdgeSignals }, a: EntityId, b: EntityId): number {
  return Math.max(rel.edge(a, b).affinity, rel.edge(b, a).affinity);
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

/**
 * What HEARING a rumor does to the listener's read of its SUBJECTS (audit E44): a rumor finally
 * changes minds, not just hands. Small directed folds keyed by the scene's nature, scaled by the
 * listener's CONFIDENCE in the belief (a fifth-hand whisper barely registers) — so noms, votes,
 * saves and blocs (which all read the relationship layer) now genuinely move on what travels.
 * Magnitudes live here only (the B59 pattern); the fold runs through the proven 0026 update rule.
 */
export const GOSSIP_HEARD: Record<string, Partial<EdgeSignals>> = {
  alliance: { threat: +0.06 },                  // "getting awfully close" — a pair is a power read
  strategy: { threat: +0.05 },                  // "plotting something"
  bonding: { threat: +0.03 },                   // "thick as thieves lately"
  showmance: { threat: +0.04 },                 // "more than friends" — a duo to the end
  gossip: { trust: -0.04 },                     // "talking about everyone behind their backs"
  conflict: { affinity: -0.03 },                // "at each other's throats" — messy to be near
  betrayal: { trust: -0.06, threat: +0.07 },    // "about to turn on someone" — dangerous to trust
};

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
 *
 * With `rel` + `subjects` (audit E44), each NPC RECEIPT also folds a small, confidence-scaled
 * move toward the rumor's subjects (`GOSSIP_HEARD`) — hearsay finally shifts third-party reads,
 * so a betrayal-rumor reaching a future HOH genuinely raises its subject's nomination danger.
 * The PLAYER's own edges are never gossip-folded: the human forms their own reads (ADR 0003 /
 * 0017 — the engine hands them the belief, not the feeling).
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
  /** The live relationship model (E44) — when present, receipts fold toward the subjects. */
  rel?: RelationshipModel;
  /** Who the rumor is ABOUT (the scene's initiator + partner). */
  subjects?: readonly EntityId[];
  /** The originating scene's nature — keys the `GOSSIP_HEARD` impact. */
  sceneType?: string;
}): { factId: string; original: string } {
  const { knowledge, graph, rng, origin, fact, rounds, rel, subjects, sceneType } = deps;
  const transmitProb = deps.transmitProb ?? GOSSIP.transmitProb;
  const decay = deps.decay ?? 0.7;
  const heard = sceneType ? GOSSIP_HEARD[sceneType] : undefined;
  /** The E44 receipt fold: listener → each subject (≠ self, ≠ player-holder), scaled by confidence. */
  const foldReceipt = (listener: EntityId, confidence: number): void => {
    if (!rel || !subjects || !heard || listener === PLAYER) return;
    const scaled = scaleImpact(heard, confidence);
    for (const subject of subjects) {
      if (subject !== listener) rel.applyImpactDirected(listener, subject, scaled, rng);
    }
  };
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
        const confidence = (belief.confidence ?? 1) * decay;
        knowledge.transmitGossip(
          from,
          to,
          {
            content: distort(belief.content, rng),
            originalContent: original,
            factId,
            confidence,
            source: from,
            hops,
            // hops + fractional noise → strictly ordered by hops, with per-telling variance.
            distortion: hops + rng.next(),
          },
          `told-by:${from}`,
        );
        // E44: hearing it MOVES the listener's read of the subjects (confidence-scaled, hidden).
        foldReceipt(to, confidence);
      }
    }
  }

  return { factId, original };
}

type KnowledgeFactLike = { hops?: number; confidence?: number; content: string };
