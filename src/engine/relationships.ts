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

  /** Apply an interaction to both directed edges, with small per-telling jitter. */
  apply(a: EntityId, b: EntityId, type: InteractionType, rng: RandomnessSource): void {
    const imp = IMPACT[type];
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const e = this.edge(x, y);
      const j = (): number => 0.8 + 0.4 * rng.next();
      e.trust = clamp(e.trust + (imp.trust ?? 0) * j());
      e.affinity = clamp(e.affinity + (imp.affinity ?? 0) * j());
      e.threat = clamp(e.threat + (imp.threat ?? 0) * j());
      e.alignment = clamp(e.alignment + (imp.alignment ?? 0) * j());
      e.confidence = clamp(e.confidence + 0.05);
    }
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
