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

/** Each retelling appends a hedge — a cosmetic "how sure are they" marker (stripped at display by
 * `humanize.ts tidyPathwaySlugs`). This alone is NOT the distortion the design mandate means by
 * "drift" (audit SG-6) — see `driftSeverity`/`swapSubject` below for the CONTENT-level mutation. */
function distort(content: string, rng: RandomnessSource): string {
  const drift = ["roughly", "or so I heard", "supposedly", "more or less", "the way I heard it"];
  return `${content} · ${rng.pick(drift)}#${rng.int(1000)}`;
}

/**
 * SG-6 fix: a severity ladder for scene-rumor NATURE (mild → alarming). A retelling can nudge the
 * CLAIM one rung in either direction — the classic game-of-telephone effect where the story itself
 * becomes wrong, not merely less certain. Order is a plausible house read, not canon; it only needs
 * to be a believable escalation/de-escalation. Covers exactly the `RUMOR_GLOSS`/`GOSSIP_HEARD` keys.
 */
const SEVERITY_LADDER: readonly string[] = [
  "bonding",
  "alliance",
  "showmance",
  "gossip",
  "strategy",
  "conflict",
  "betrayal",
];

/** Retellings before content-level drift can kick in — a direct (1-hop) retelling stays faithful to
 * the nature of what was actually seen; the story only starts to warp on the SECOND retelling
 * onward (real telephone-game behavior, and it keeps the direct-hearsay case minimally changed). */
const CONTENT_DRIFT_MIN_HOPS = 2;
/** Chance a hop past the floor nudges the claimed nature one rung on the ladder. */
const TYPE_DRIFT_PROB = 0.3;
/** Chance a hop past the floor swaps ONE subject for a socially-adjacent houseguest (mistaken identity). */
const SUBJECT_SWAP_PROB = 0.15;

/** Nudge a scene-rumor's claimed nature one rung on the severity ladder, a random direction each
 * time (a rumor can escalate OR soften). A type outside the ladder (a non-scene-rumor caller) is
 * returned unchanged. */
function driftSeverity(type: string, rng: RandomnessSource): string {
  const idx = SEVERITY_LADDER.indexOf(type);
  if (idx < 0) return type;
  const step = rng.next() < 0.5 ? -1 : 1;
  const next = Math.min(SEVERITY_LADDER.length - 1, Math.max(0, idx + step));
  return SEVERITY_LADDER[next]!;
}

/** Swap ONE side of a rumor's subject pair for a socially-adjacent houseguest — "wait, I heard it
 * was HER, not you." Picks a graph-neighbor of the reteller who isn't already one of the two
 * subjects; falls back to the unchanged pair when no such neighbor exists. */
function swapSubject(
  subjects: readonly [EntityId, EntityId],
  from: EntityId,
  graph: SocialGraph,
  rng: RandomnessSource,
): readonly [EntityId, EntityId] {
  const candidates = graph.neighbors(from).filter((id) => id !== subjects[0] && id !== subjects[1]);
  if (candidates.length === 0) return subjects;
  const replacement = rng.pick(candidates);
  return rng.next() < 0.5 ? [replacement, subjects[1]] : [subjects[0], replacement];
}

/**
 * Diffuse a hidden fact NPC-to-NPC across the social graph, one hop per round.
 * Every retelling is recorded as its own event (via `transmitGossip`), each
 * recipient holds the fact as a belief with provenance + confidence (decaying
 * with hops) + distortion (growing with hops). It reaches the player only if a
 * chain of tellings terminates at the player. Deterministic under a fixed seed.
 *
 * SG-6 fix: past `CONTENT_DRIFT_MIN_HOPS` retellings, a scene-rumor (`sceneType` + `subjects`
 * present) can genuinely become WRONG, not just less certain — each holder's BELIEVED nature and
 * subject pair are tracked per branch of the retelling tree (`believedType`/`believedSubjects`;
 * different chains can end up believing different things) and, with a small seeded chance per hop,
 * `driftSeverity` nudges the claimed nature one rung and/or `swapSubject` swaps in a socially-
 * adjacent houseguest. The regenerated belief is what gets retold and what a downstream `told-by`
 * pathway can surface to the player — so a distorted belief with a source + confidence, per I3,
 * literally may not match what happened. `originalContent`/`original` (the Vault ground truth) are
 * NEVER touched by drift — only the diffusing belief is distorted, exactly as the mandate requires.
 * All drift/hedge randomness is drawn from a per-hop FORKED child stream (`RandomnessSource.fork`),
 * which by construction never advances the parent `rng`'s own sequence — so this cannot perturb any
 * other seeded draw (competition, votes, jury) sharing that parent stream this tick.
 *
 * With `rel` + `subjects` (audit E44), each NPC RECEIPT also folds a small, confidence-scaled move
 * toward the rumor's CURRENTLY BELIEVED subjects (`GOSSIP_HEARD`, keyed by the currently believed
 * nature) — hearsay finally shifts third-party reads, so a betrayal-rumor reaching a future HOH
 * genuinely raises its subject's nomination danger, and a drifted rumor can misdirect that read onto
 * the wrong houseguest. The PLAYER's own edges are never gossip-folded: the human forms their own
 * reads (ADR 0003 / 0017 — the engine hands them the belief, not the feeling).
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
  /** The originating scene's nature — keys the `GOSSIP_HEARD` impact and seeds content drift. */
  sceneType?: string;
}): { factId: string; original: string } {
  const { knowledge, graph, rng, origin, fact, rounds, rel, sceneType } = deps;
  const transmitProb = deps.transmitProb ?? GOSSIP.transmitProb;
  const decay = deps.decay ?? 0.7;
  const factId = `fact:${origin}:${rng.int(1_000_000)}`;
  const original = fact.content;

  knowledge.seedBelief(
    origin,
    { content: original, originalContent: original, factId, confidence: 1, hops: 0, distortion: 0, source: origin },
    "origin",
  );

  // Per-holder BELIEVED claim state (SG-6): what THIS holder currently thinks the rumor's nature and
  // subjects are — drifts independently down each branch of the retelling tree. Untouched (stays
  // `undefined`) for callers that pass no `sceneType` (e.g. position/tie whispers), which keep
  // today's cosmetic-only hedge — those never asserted a nature/subject claim to begin with.
  const believedType = new Map<EntityId, string>();
  const believedSubjects = new Map<EntityId, readonly [EntityId, EntityId]>();
  const hasSubjectPair = deps.subjects && deps.subjects.length === 2;
  if (sceneType) believedType.set(origin, sceneType);
  if (hasSubjectPair) believedSubjects.set(origin, [deps.subjects![0]!, deps.subjects![1]!]);

  /** The E44 receipt fold: listener → each (believed) subject (≠ self, ≠ player-holder), scaled by
   * confidence and keyed by the LISTENER's believed nature — a drifted belief folds as what was
   * actually heard, never silently corrected back to ground truth. */
  const foldReceipt = (
    listener: EntityId,
    confidence: number,
    type: string | undefined,
    subjects: readonly EntityId[] | undefined,
  ): void => {
    const heard = type ? GOSSIP_HEARD[type] : undefined;
    if (!rel || !subjects || !heard || listener === PLAYER) return;
    const scaled = scaleImpact(heard, confidence);
    for (const subject of subjects) {
      if (subject !== listener) rel.applyImpactDirected(listener, subject, scaled, rng);
    }
  };

  const holds = (e: EntityId): boolean => knowledge.knownTo(e).some((k) => k.factId === factId);
  const beliefOf = (e: EntityId): KnowledgeFactLike | undefined =>
    knowledge.knownTo(e).find((k) => k.factId === factId);

  for (let r = 0; r < rounds; r++) {
    const holders = graph.nodes().filter(holds); // snapshot: one hop per round
    for (const from of holders) {
      const belief = beliefOf(from)!;
      const fromType = believedType.get(from);
      const fromSubjects = believedSubjects.get(from);
      for (const to of graph.neighbors(from)) {
        if (holds(to)) continue;
        if (rng.next() >= transmitProb) continue;
        const hops = (belief.hops ?? 0) + 1;
        const confidence = (belief.confidence ?? 1) * decay;
        // A DEDICATED forked stream for this retelling's hedge/drift — `RandomnessSource.fork` reads
        // the parent's current state without advancing it, so nothing drawn here shifts what the
        // parent `rng` yields on its NEXT call (the transmit-probability roll above, or any other
        // seeded draw elsewhere this tick, is byte-identical to before this feature existed).
        const driftRng = rng.fork(`gossip-drift:${factId}:${from}:${to}:${hops}`);
        let toType = fromType;
        let toSubjects = fromSubjects;
        let believedContent = belief.content;
        if (hops >= CONTENT_DRIFT_MIN_HOPS) {
          if (fromType && driftRng.next() < TYPE_DRIFT_PROB) toType = driftSeverity(fromType, driftRng);
          if (fromSubjects && driftRng.next() < SUBJECT_SWAP_PROB) {
            toSubjects = swapSubject(fromSubjects, from, graph, driftRng);
          }
          if (toType && toSubjects) believedContent = rumorFrom(toSubjects[0], toSubjects[1], toType);
        }
        knowledge.transmitGossip(
          from,
          to,
          {
            content: distort(believedContent, driftRng),
            originalContent: original,
            factId,
            confidence,
            source: from,
            hops,
            // hops + fractional noise → strictly ordered by hops, with per-telling variance.
            distortion: hops + driftRng.next(),
          },
          `told-by:${from}`,
        );
        if (toType) believedType.set(to, toType);
        if (toSubjects) believedSubjects.set(to, toSubjects);
        // E44: hearing it MOVES the listener's read of the (believed) subjects, hidden.
        foldReceipt(to, confidence, toType, toSubjects);
      }
    }
  }

  return { factId, original };
}

type KnowledgeFactLike = { hops?: number; confidence?: number; content: string };
