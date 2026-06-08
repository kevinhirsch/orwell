/**
 * Relationship math — the SINGLE tunable constants module (feature 0026).
 *
 * 0017 fixed *what* a relationship edge is (directed, graded, asymmetric signals,
 * organic labels). This fixes *how the numbers move*: per-interaction impacts,
 * betrayal-shock, decay/mean-reversion, confidence growth, and the disposition ×
 * temperature modulation that makes each game's feel emergent. **Every number the
 * update rule uses lives here** — retune the feel (or wire a future God-Mode knob,
 * 0016) without touching the logic. The shape is fixed; the numbers are config.
 *
 * Default feel: **realistic & competitive (sticky)** — a blindside lands hard and
 * lingers; trust accrues slowly. A *clash* (paranoid/villain) holder trends
 * stickier still; a *bond* (loyalist/social) holder forgives faster. The player
 * never sees any of these numbers (0020).
 */

/** Directed, graded, asymmetric relationship signals (0017). */
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

/** How a holder frames relationships — drives sticky↔forgiving dynamics + on-the-spot labels. */
export type RelationshipDisposition = "clash" | "bond" | "neutral";

export interface DispositionProfile {
  /** Scales ADVERSE moves (trust/affinity down, threat up) — clash lands them harder. */
  adverseScale: number;
  /** Scales BONDING moves (trust/affinity/alignment up) — bond builds them faster. */
  bondScale: number;
  /** Scales mean-reversion in decay — clash barely fades (sticky), bond fades fast (forgiving). */
  decayScale: number;
}

export interface RelationshipConstants {
  baseline: EdgeSignals;
  IMPACT: Record<InteractionType, Partial<EdgeSignals>>;
  /** The large single-step adverse move of a witnessed betrayal (the sticky core). */
  BETRAYAL_SHOCK: Partial<EdgeSignals>;
  /** Slow ordinary drift toward baseline when an edge is untended. */
  DECAY_RATE: number;
  /** <1 ⇒ wariness (threat) reverts slower than warmth — a blindside outlasts a cold shoulder (§6). */
  THREAT_DECAY_FACTOR: number;
  /** Each interaction firms the read by this much. */
  CONFIDENCE_STEP: number;
  /** Bounded per-moment variance band (jitter ∈ [1−J/2, 1+J/2]); the temperature seam (0006). */
  TEMPERATURE_JITTER: number;
  dispositionFactors: Record<RelationshipDisposition, DispositionProfile>;
  thresholds: { alliance: number; ally: number; enemy: number; knowledge: number };
}

// Betrayal-shock: a LARGE single step — the competitive, realistic core, and the single biggest
// lever on "feel." Named so it is the one knob to turn (referenced by IMPACT.betrayal below).
const BETRAYAL_SHOCK: Partial<EdgeSignals> = { trust: -0.32, affinity: -0.28, threat: +0.32 };

export const RELATIONSHIP_CONSTANTS: RelationshipConstants = {
  baseline: { trust: 0.25, affinity: 0.25, threat: 0.1, alignment: 0.2, confidence: 0 },
  IMPACT: {
    bonding: { affinity: +0.15, trust: +0.1 },
    strategy: { trust: +0.12, affinity: +0.06, alignment: +0.12 },
    alliance: { trust: +0.16, affinity: +0.14, alignment: +0.15 },
    showmance: { affinity: +0.2, trust: +0.12 },
    gossip: { trust: +0.05, alignment: +0.04 },
    conflict: { affinity: -0.16, trust: -0.13, threat: +0.16 },
    betrayal: BETRAYAL_SHOCK,
  },
  BETRAYAL_SHOCK,
  DECAY_RATE: 0.05, // slow — grudges and bonds persist when untended (sticky default)
  THREAT_DECAY_FACTOR: 0.6, // threat lingers longer than warmth
  CONFIDENCE_STEP: 0.05,
  TEMPERATURE_JITTER: 0.4, // jitter ∈ [0.8, 1.2]
  dispositionFactors: {
    clash: { adverseScale: 1.5, bondScale: 0.85, decayScale: 0.5 }, // paranoid / villain — sticky
    bond: { adverseScale: 0.7, bondScale: 1.2, decayScale: 1.7 }, // loyalist / social — forgiving
    neutral: { adverseScale: 1.0, bondScale: 1.0, decayScale: 1.0 },
  },
  thresholds: { alliance: 0.5, ally: 0.35, enemy: 0.3, knowledge: 0.3 },
};

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
