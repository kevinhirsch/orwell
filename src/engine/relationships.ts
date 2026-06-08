import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Directed, graded, asymmetric relationship beliefs (decision 0002): no binary
 * ally/enemy flags. An "alliance" is not stored — it's read off the graded
 * signals crossing a threshold, and can form or fracture as the signals move.
 * This is the minimal computed model the behavioral-fidelity feature needs; the
 * full signal set / math is tunable config still to firm up.
 */
export interface EdgeSignals {
  trust: number;
  affinity: number;
  threat: number;
  alignment: number;
  confidence: number;
}

export type InteractionType =
  | "alliance"
  | "gossip"
  | "conflict"
  | "bonding"
  | "strategy"
  | "showmance"
  | "betrayal";

const IMPACT: Record<InteractionType, Partial<EdgeSignals>> = {
  bonding: { affinity: +0.15, trust: +0.1 },
  strategy: { trust: +0.12, affinity: +0.06, alignment: +0.12 },
  alliance: { trust: +0.16, affinity: +0.14, alignment: +0.15 },
  showmance: { affinity: +0.2, trust: +0.12 },
  gossip: { trust: +0.05, alignment: +0.04 },
  conflict: { affinity: -0.16, trust: -0.13, threat: +0.16 },
  betrayal: { trust: -0.32, affinity: -0.28, threat: +0.32 },
};

const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const neutral = (): EdgeSignals => ({ trust: 0.25, affinity: 0.25, threat: 0.1, alignment: 0.2, confidence: 0 });
export const NEUTRAL_BOND = 0.25;

/** A read below this confidence is a SUSPICION (hunch), not knowledge (decision 0002). */
export const CONFIDENCE_KNOWLEDGE = 0.3;

/** How a holder frames relationships — drives on-the-spot labels (never stored). */
export type RelationshipDisposition = "clash" | "bond" | "neutral";

export interface RelationshipRead {
  signals: EdgeSignals;
  confidence: number;
  kind: "knowledge" | "suspicion";
}

/**
 * Read an organic label from graded signals THROUGH the holder's disposition — the
 * same history reads as more of a threat to a paranoid (clash) holder and more of a
 * bond to a trusting (bond) one. Derived on the spot; an "ally/enemy" label is NEVER
 * stored (decision 0002).
 */
export function relationshipLabel(s: EdgeSignals, disposition: RelationshipDisposition): "ally" | "enemy" | "acquaintance" {
  const bond = (s.trust + s.affinity) / 2;
  const threatW = disposition === "clash" ? 1.5 : disposition === "bond" ? 0.6 : 1.0;
  const bondW = disposition === "bond" ? 1.5 : disposition === "clash" ? 0.6 : 1.0;
  const threatScore = s.threat * threatW;
  const bondScore = bond * bondW;
  if (threatScore >= bondScore) return threatScore > 0.3 ? "enemy" : "acquaintance";
  return bondScore > 0.35 ? "ally" : "acquaintance";
}

export class RelationshipModel {
  private readonly edges = new Map<string, EdgeSignals>();

  constructor(private readonly allianceThreshold: number) {}

  private key(a: EntityId, b: EntityId): string {
    return `${a}->${b}`;
  }

  /** The stored (mutable) directed edge A→B, lazily created at neutral. */
  edge(a: EntityId, b: EntityId): EdgeSignals {
    const k = this.key(a, b);
    let e = this.edges.get(k);
    if (!e) {
      e = neutral();
      this.edges.set(k, e);
    }
    return e;
  }

  private applyOneDirection(from: EntityId, to: EntityId, imp: Partial<EdgeSignals>, rng: RandomnessSource): void {
    const e = this.edge(from, to);
    const j = (): number => 0.8 + 0.4 * rng.next();
    e.trust = clamp(e.trust + (imp.trust ?? 0) * j());
    e.affinity = clamp(e.affinity + (imp.affinity ?? 0) * j());
    e.threat = clamp(e.threat + (imp.threat ?? 0) * j());
    e.alignment = clamp(e.alignment + (imp.alignment ?? 0) * j());
    e.confidence = clamp(e.confidence + 0.05);
  }

  /** Apply a mutual interaction to both directed edges, with small per-telling jitter. */
  apply(a: EntityId, b: EntityId, type: InteractionType, rng: RandomnessSource): void {
    const imp = IMPACT[type];
    this.applyOneDirection(a, b, imp, rng);
    this.applyOneDirection(b, a, imp, rng);
  }

  /**
   * Directed update: only `holder`→`other` moves. One-sided investment (A bonds with B
   * who never reciprocates) makes the edges asymmetric — the heart of decision 0002.
   */
  applyDirected(holder: EntityId, other: EntityId, type: InteractionType, rng: RandomnessSource): void {
    this.applyOneDirection(holder, other, IMPACT[type], rng);
  }

  /**
   * A relationship read: the graded signals plus a confidence. Below the knowledge
   * threshold the read is a SUSPICION (a hunch with little data), not knowledge —
   * it firms up as consistent interactions accrue.
   */
  read(a: EntityId, b: EntityId): RelationshipRead {
    const e = this.edge(a, b);
    return {
      signals: { ...e },
      confidence: e.confidence,
      kind: e.confidence >= CONFIDENCE_KNOWLEDGE ? "knowledge" : "suspicion",
    };
  }

  /** Neglect: mean-revert every edge toward the holder's baseline. `rate` ∈ (0,1]. */
  decay(rate: number): void {
    const base = neutral();
    for (const e of this.edges.values()) {
      e.trust += (base.trust - e.trust) * rate;
      e.affinity += (base.affinity - e.affinity) * rate;
      e.threat += (base.threat - e.threat) * rate;
      e.alignment += (base.alignment - e.alignment) * rate;
      e.confidence = clamp(e.confidence - rate * 0.5);
    }
  }

  /** Plain-data snapshot of every directed edge — graded signals only, NEVER a stored label. */
  serialize(): { edges: Array<{ from: EntityId; to: EntityId } & EdgeSignals> } {
    const edges: Array<{ from: EntityId; to: EntityId } & EdgeSignals> = [];
    for (const [k, e] of this.edges) {
      const [from, to] = k.split("->") as [EntityId, EntityId];
      edges.push({ from, to, ...e });
    }
    return { edges };
  }

  /**
   * Houseguest's Choice / NPC motivation: pick the strongest available bond
   * (trust+affinity) with BOUNDED temperature variance — a clear bond is not
   * flipped by chance, but near-ties wobble.
   */
  chooseStrongestBond(holder: EntityId, candidates: EntityId[], rng: RandomnessSource, temperature = 0.1): EntityId {
    let best = candidates[0]!;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const score = this.bondStrength(holder, c) + (rng.next() - 0.5) * temperature;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /** A soft, momentary read — the (trust+affinity) strength of a directed bond. */
  bondStrength(a: EntityId, b: EntityId): number {
    const e = this.edge(a, b);
    return (e.trust + e.affinity) / 2;
  }

  /** An alliance is "active" when the bond is mutual and over threshold. */
  allianceActive(a: EntityId, b: EntityId): boolean {
    return this.bondStrength(a, b) >= this.allianceThreshold && this.bondStrength(b, a) >= this.allianceThreshold;
  }

  /** Every stored directed bond strength — for change detection over time. */
  allBondStrengths(): number[] {
    return [...this.edges.values()].map((e) => (e.trust + e.affinity) / 2);
  }
}
