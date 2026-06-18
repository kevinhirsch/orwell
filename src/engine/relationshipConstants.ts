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

/** Directed, graded, asymmetric relationship signals (0017 + audit E54). */
export interface EdgeSignals {
  trust: number;
  affinity: number;
  threat: number;
  alignment: number;
  confidence: number;
  /**
   * ADR 0002's EVIDENCE signal (audit E54): demonstrated loyalty — fed only by *binding acts*
   * (honored deals, protective votes, a veto save), torn down by betrayal. Unlike `trust`
   * (sentiment), reliability moves un-jittered and never decays on neglect: proof stands until
   * contradicted. Consumed by `bondStrength` (Houseguest's Choice, alliances, NPC motivation).
   */
  reliability: number;
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
  /** How hard `reliability` (evidence, E54) weighs into `bondStrength` beside trust+affinity sentiment. */
  RELIABILITY_WEIGHT: number;
  dispositionFactors: Record<RelationshipDisposition, DispositionProfile>;
  thresholds: {
    alliance: number; ally: number; enemy: number; knowledge: number;
    /** An NPC veto holder saves a nominee they trust above this (B59 — one number, three call sites). */
    vetoSave: number;
  };
  /**
   * Move-in first impressions (B55/audit C5+C6): day-one reads start NEAR BASELINE (not uniform
   * noise), the threat read leans on the PUBLIC archetype's competitive menace, and confidence
   * starts BELOW `thresholds.knowledge` — a move-in read is a HUNCH, never day-one knowledge.
   */
  MOVE_IN: { confidence: number; spread: number; threatWeight: number };
  /**
   * The BYSTANDER observation fold (audit 2026-06-18, owner ruling). A houseguest who merely
   * WITNESSED a scene they were not part of must move by THEIR OWN beliefs — never the partner's
   * full bond, and never a uniform group step. Their edge toward the actor shifts a small amount,
   * SIGNED by structural balance (how they feel about who the actor engaged) and shaded by their
   * existing suspicion of the actor. A neutral bystander barely moves; one who dislikes the partner
   * cools/worries; one who already distrusts the actor reads warmth as scheming (threat ▲). A
   * witnessed BETRAYAL is the "universally human" exception — it chills the room more directly.
   */
  OBSERVATION: {
    /** Overall fraction of a direct fold a bystander can feel (keeps observation small). */
    scale: number;
    /** Reference magnitudes the structural-balance tilt scales (affinity/trust/threat). */
    refAffinity: number; refTrust: number; refThreat: number;
    /** How hard an already-wary bystander reads a warm scene as a developing threat. */
    suspicionWeight: number;
    /** Interaction kinds that move bystanders directly (a witnessed shock) — the human exception. */
    universal: InteractionType[];
  };
}

// Betrayal-shock: a LARGE single step — the competitive, realistic core, and the single biggest
// lever on "feel." Named so it is the one knob to turn (referenced by IMPACT.betrayal below).
// Proven disloyalty also tears down the EVIDENCE signal (E54) — harder than sentiment falls.
const BETRAYAL_SHOCK: Partial<EdgeSignals> = { trust: -0.32, affinity: -0.28, threat: +0.32, reliability: -0.3 };

export const RELATIONSHIP_CONSTANTS: RelationshipConstants = {
  baseline: { trust: 0.25, affinity: 0.25, threat: 0.1, alignment: 0.2, confidence: 0, reliability: 0.3 },
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
  RELIABILITY_WEIGHT: 0.25, // evidence (E54) shades — never replaces — the sentiment bond read
  dispositionFactors: {
    clash: { adverseScale: 1.5, bondScale: 0.85, decayScale: 0.5 }, // paranoid / villain — sticky
    bond: { adverseScale: 0.7, bondScale: 1.2, decayScale: 1.7 }, // loyalist / social — forgiving
    neutral: { adverseScale: 1.0, bondScale: 1.0, decayScale: 1.0 },
  },
  thresholds: { alliance: 0.5, ally: 0.35, enemy: 0.3, knowledge: 0.3, vetoSave: 0.6 },
  MOVE_IN: { confidence: 0.15, spread: 0.15, threatWeight: 0.35 },
  // Bystanders feel ~half a reference move at most, signed by their own beliefs — so a witnessed
  // bond never bonds the room, and the spread across witnesses is wide (some up, some down, most ~0).
  OBSERVATION: {
    scale: 0.5,
    refAffinity: 0.12, refTrust: 0.06, refThreat: 0.1,
    suspicionWeight: 0.6,
    universal: ["betrayal"],
  },
};

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Scale every component of a named impact (manner-scaled folds E48, confidence-scaled gossip E44). */
export function scaleImpact(impact: Partial<EdgeSignals>, factor: number): Partial<EdgeSignals> {
  const out: Partial<EdgeSignals> = {};
  for (const [k, v] of Object.entries(impact)) out[k as keyof EdgeSignals] = (v as number) * factor;
  return out;
}

/**
 * The hidden relationship consequence of each ceremony act (feature B38 / audit C1, reworked by
 * audit E47/E48). The weekly loop's most consequential moves — nominations, veto saves,
 * replacements, evictions, comp wins — must move trust/affinity/threat, not just be read. Each act
 * maps to a NAMED impact whose magnitudes live HERE (shared with `IMPACT` where the act genuinely
 * is that interaction); the fold still runs through the proven update rule (disposition scaling,
 * decay, confidence, temperature jitter). Applied engine-side in the commit path; the player never
 * sees a number (0001).
 *
 *   nominated   nominee → HOH        adverse (threat▲ trust▼)      — "you put me up"
 *   veto-saved  saved   → holder     a real bond + EVIDENCE (E54)  — "you saved me"
 *   replaced    replacement → HOH    betrayal-shock if trusted     — "you used the veto to get ME"
 *   evicted     evictee → HOH+voters betrayal-shock × MANNER (E48) — "you sent me out"
 *   comp-won    everyone → winner    threat▲ ONLY (E47)            — "they're dangerous now"
 *
 * E47: a comp win is a THREAT read, not a grievance — the house does not stop *liking* its own
 * winner; allies stay warm while everyone recalibrates the danger.
 */
export type CeremonyAct = "nominated" | "veto-saved" | "replaced" | "evicted" | "comp-won";

/** A comp win moves only the danger read (E47) — no affinity/trust souring from a clean victory. */
const COMP_WON_IMPACT: Partial<EdgeSignals> = { threat: +0.14 };

/** A veto save is alliance-grade warmth PLUS demonstrated protection — the E54 evidence signal. */
const VETO_SAVED_IMPACT: Partial<EdgeSignals> = { trust: +0.16, affinity: +0.14, alignment: +0.15, reliability: +0.15 };

export const CEREMONY_IMPACTS: Record<CeremonyAct, Partial<EdgeSignals>> = {
  nominated: { affinity: -0.16, trust: -0.13, threat: +0.16 }, // = IMPACT.conflict
  "veto-saved": VETO_SAVED_IMPACT,
  replaced: BETRAYAL_SHOCK,
  evicted: BETRAYAL_SHOCK, // base magnitude; the live fold scales it by the recorded MANNER (E48)
  "comp-won": COMP_WON_IMPACT,
};

/**
 * How the eviction fold scales by the evictee's RECORDED manner (audit E48): a betrayal lands the
 * full shock; a blindside most of it; a "respected" eviction — a clean, expected move from a known
 * rival — leaves a fraction of the resentment, not a feud. `disrespected` (a cold goodbye) sits
 * between. Engine-only; agrees with the jury manner read the finale already weighs (0037).
 */
export const EVICTION_MANNER_SCALE = {
  betrayed: 1.0,
  blindsided: 0.8,
  disrespected: 0.6,
  respected: 0.25,
} as const;

/**
 * Deal consequences (0039 + audit E43/E54): HONORING a promise is a real, bounded positive fold —
 * the protected party registers the kept word (trust/alignment up, plus the evidence signal).
 * Applied once per honoring binding action by `DealLedger.reconcile`; breaking already lands
 * `BETRAYAL_SHOCK` above. Magnitudes live here only (the B59 grep gate).
 */
export const DEAL_IMPACTS = {
  honored: { trust: +0.06, affinity: +0.03, alignment: +0.04, reliability: +0.1 } as Partial<EdgeSignals>,
} as const;
