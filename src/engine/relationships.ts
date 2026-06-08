import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import {
  RELATIONSHIP_CONSTANTS,
  clamp01 as clamp,
  type EdgeSignals,
  type InteractionType,
  type RelationshipConstants,
  type RelationshipDisposition,
} from "./relationshipConstants";

/**
 * Directed, graded, asymmetric relationship beliefs (decision 0002): no binary
 * ally/enemy flags. An "alliance" is not stored — it's read off the graded
 * signals crossing a threshold, and can form or fracture as the signals move.
 *
 * The *shape* lives here (0017); the *numbers* — impacts, betrayal-shock, decay,
 * confidence, disposition × temperature — live in the single tunable constants
 * module (`relationshipConstants.ts`, feature 0026), injected so the feel is
 * retunable without touching this logic.
 */
export type { EdgeSignals, InteractionType, RelationshipDisposition };

const baseline = (c: RelationshipConstants): EdgeSignals => ({ ...c.baseline });
export const NEUTRAL_BOND =
  (RELATIONSHIP_CONSTANTS.baseline.trust + RELATIONSHIP_CONSTANTS.baseline.affinity) / 2;

/** A read below this confidence is a SUSPICION (hunch), not knowledge (decision 0002). */
export const CONFIDENCE_KNOWLEDGE = RELATIONSHIP_CONSTANTS.thresholds.knowledge;

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
export function relationshipLabel(
  s: EdgeSignals,
  disposition: RelationshipDisposition,
  constants: RelationshipConstants = RELATIONSHIP_CONSTANTS,
): "ally" | "enemy" | "acquaintance" {
  const bond = (s.trust + s.affinity) / 2;
  const threatW = disposition === "clash" ? 1.5 : disposition === "bond" ? 0.6 : 1.0;
  const bondW = disposition === "bond" ? 1.5 : disposition === "clash" ? 0.6 : 1.0;
  const threatScore = s.threat * threatW;
  const bondScore = bond * bondW;
  if (threatScore >= bondScore) return threatScore > constants.thresholds.enemy ? "enemy" : "acquaintance";
  return bondScore > constants.thresholds.ally ? "ally" : "acquaintance";
}

export class RelationshipModel {
  private readonly edges = new Map<string, EdgeSignals>();
  /** Per-holder disposition (from `Character`, 0004/0015) — the per-game-feel input (§7). */
  private readonly dispositions = new Map<EntityId, RelationshipDisposition>();

  constructor(
    private readonly allianceThreshold: number,
    private readonly constants: RelationshipConstants = RELATIONSHIP_CONSTANTS,
  ) {}

  private key(a: EntityId, b: EntityId): string {
    return `${a}->${b}`;
  }

  /** Set how a holder frames relationships (clash=sticky/paranoid, bond=forgiving). */
  setDisposition(holder: EntityId, disposition: RelationshipDisposition): void {
    this.dispositions.set(holder, disposition);
  }

  private dispositionOf(holder: EntityId): RelationshipDisposition {
    return this.dispositions.get(holder) ?? "neutral";
  }

  /** The stored (mutable) directed edge A→B, lazily created at baseline. */
  edge(a: EntityId, b: EntityId): EdgeSignals {
    const k = this.key(a, b);
    let e = this.edges.get(k);
    if (!e) {
      e = baseline(this.constants);
      this.edges.set(k, e);
    }
    return e;
  }

  /**
   * The firmed update rule (0026 §4): each signal moves by `impact × dispositionFactor ×
   * temperatureJitter`, clamped. Adverse moves (trust/affinity down, threat up) scale by the
   * holder's `adverseScale`; bonding moves by `bondScale`. Four jitter draws are taken in a
   * fixed order (trust, affinity, threat, alignment) so seeded runs stay reproducible — with a
   * NEUTRAL holder and default constants this is identical to the pre-0026 behavior.
   */
  private applyOneDirection(from: EntityId, to: EntityId, type: InteractionType, rng: RandomnessSource): void {
    const e = this.edge(from, to);
    const C = this.constants;
    const disp = C.dispositionFactors[this.dispositionOf(from)];
    const imp = C.IMPACT[type];
    const jitter = (): number => 1 + (rng.next() - 0.5) * C.TEMPERATURE_JITTER;
    const jTrust = jitter();
    const jAffinity = jitter();
    const jThreat = jitter();
    const jAlignment = jitter();
    const dTrust = imp.trust ?? 0;
    const dAffinity = imp.affinity ?? 0;
    const dThreat = imp.threat ?? 0;
    const dAlignment = imp.alignment ?? 0;
    e.trust = clamp(e.trust + dTrust * (dTrust < 0 ? disp.adverseScale : disp.bondScale) * jTrust);
    e.affinity = clamp(e.affinity + dAffinity * (dAffinity < 0 ? disp.adverseScale : disp.bondScale) * jAffinity);
    e.threat = clamp(e.threat + dThreat * (dThreat > 0 ? disp.adverseScale : disp.bondScale) * jThreat);
    e.alignment = clamp(e.alignment + dAlignment * disp.bondScale * jAlignment);
    e.confidence = clamp(e.confidence + C.CONFIDENCE_STEP);
  }

  /** Apply a mutual interaction to both directed edges, with small per-telling jitter. */
  apply(a: EntityId, b: EntityId, type: InteractionType, rng: RandomnessSource): void {
    this.applyOneDirection(a, b, type, rng);
    this.applyOneDirection(b, a, type, rng);
  }

  /**
   * Directed update: only `holder`→`other` moves. One-sided investment (A bonds with B
   * who never reciprocates) makes the edges asymmetric — the heart of decision 0002.
   */
  applyDirected(holder: EntityId, other: EntityId, type: InteractionType, rng: RandomnessSource): void {
    this.applyOneDirection(holder, other, type, rng);
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

  /**
   * Neglect: mean-revert every edge toward baseline. `rate` ∈ (0,1]. Disposition-scaled
   * (0026 §6): a clash holder barely fades (sticky grudges/bonds), a bond holder fades fast
   * (forgiving). Threat reverts slower than warmth (`THREAT_DECAY_FACTOR`) so a blindside
   * outlasts a cold shoulder. A NEUTRAL holder at default constants keeps the prior behavior.
   */
  decay(rate: number): void {
    const C = this.constants;
    const base = C.baseline;
    for (const [k, e] of this.edges) {
      const holder = k.split("->")[0] as EntityId;
      const r = clamp(rate * C.dispositionFactors[this.dispositionOf(holder)].decayScale);
      e.trust += (base.trust - e.trust) * r;
      e.affinity += (base.affinity - e.affinity) * r;
      e.threat += (base.threat - e.threat) * r * C.THREAT_DECAY_FACTOR;
      e.alignment += (base.alignment - e.alignment) * r;
      e.confidence = clamp(e.confidence - r * 0.5);
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

  /** Replace all edges from a serialized snapshot — recall after leaving/restart (0023/0007). */
  load(edges: ReadonlyArray<{ from: EntityId; to: EntityId } & EdgeSignals>): void {
    this.edges.clear();
    for (const e of edges) {
      this.edges.set(this.key(e.from, e.to), {
        trust: e.trust, affinity: e.affinity, threat: e.threat, alignment: e.alignment, confidence: e.confidence,
      });
    }
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
