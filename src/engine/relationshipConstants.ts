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
 * The FRIENDLY natures (feature 0078 Phase 2) — downtime social warmth, NOT game talk: a pair just
 * hanging out or growing close. A house isn't always plotting, so these are the DEFAULT texture of
 * ordinary life. Everything else (alliance / strategy / conflict / betrayal / gossip) is a GAME nature.
 */
export const FRIENDLY_NATURES: ReadonlySet<InteractionType> = new Set<InteractionType>(["bonding", "showmance"]);

/**
 * The relationship fold an off-screen scene of the given nature takes (feature 0078 Phase 2 — "co-presence
 * is not game talk; motivation sets the nature"). A GAME nature folds its full strategic `IMPACT`
 * (trust / threat / alignment that feed the vote math) — BYTE-IDENTICAL to the pre-0078 society, so the
 * calibration spine is untouched there. A FRIENDLY nature warms the bond — AFFINITY ONLY — and folds NO
 * strategic weight (owner ruling: friendly conversation builds the relationship without scheming, no
 * vote-affecting change). Pure, draws no rng; the caller's fold takes the same four jitter draws either
 * way (`applyOneDirection`), so swapping a game fold for the friendly one is draw-count-stable — only the
 * friendly magnitudes shift, which the 0078 Phase-2 calibration pass re-verifies.
 */
export function natureFoldImpact(type: InteractionType): Partial<EdgeSignals> {
  const base = RELATIONSHIP_CONSTANTS.IMPACT[type];
  // A game scene folds the strategic weights, unchanged (same object ref ⇒ byte-identical). A friendly
  // scene warms the bond ONLY — its affinity projection. (A friendly nature without an affinity impact
  // would yield `{ affinity: undefined }`, which `applyOneDirection` reads as `?? 0` — i.e. no move —
  // exactly as an empty fold; both friendly natures carry affinity today, so no empty-fold case arises.)
  return FRIENDLY_NATURES.has(type) ? { affinity: base.affinity } : base;
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
export type CeremonyAct = "nominated" | "veto-saved" | "replaced" | "evicted" | "comp-won" | "self-evicted";

/** A comp win moves only the danger read (E47) — no affinity/trust souring from a clean victory. */
const COMP_WON_IMPACT: Partial<EdgeSignals> = { threat: +0.14 };

/** A veto save is alliance-grade warmth PLUS demonstrated protection — the E54 evidence signal. */
const VETO_SAVED_IMPACT: Partial<EdgeSignals> = { trust: +0.16, affinity: +0.14, alignment: +0.15, reliability: +0.15 };

/**
 * How the PRESENT HOUSE reads a houseguest who VOLUNTARILY walks out (0061): a rival removed
 * themselves, so the danger read drops (threat▼) and warmth/reliability dip a little — they quit on
 * the house, which a competitor weighs (a quitter is not someone you'd have leaned on). A modest,
 * signed move, never a betrayal-grade shock. The leaver's own edges don't matter — they're gone.
 */
const SELF_EVICTED_IMPACT: Partial<EdgeSignals> = { threat: -0.12, affinity: -0.06, reliability: -0.1 };

export const CEREMONY_IMPACTS: Record<CeremonyAct, Partial<EdgeSignals>> = {
  nominated: { affinity: -0.16, trust: -0.13, threat: +0.16 }, // = IMPACT.conflict
  "veto-saved": VETO_SAVED_IMPACT,
  replaced: BETRAYAL_SHOCK,
  evicted: BETRAYAL_SHOCK, // base magnitude; the live fold scales it by the recorded MANNER (E48)
  "comp-won": COMP_WON_IMPACT,
  "self-evicted": SELF_EVICTED_IMPACT, // 0061: the present house's read of a voluntary walk-out
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
 * The generative-consequence path (ADR 0005 — "split authority by openness"). The LLM may PROPOSE a
 * per-edge consequence SHAPE — which directed signal moves, in which direction — but NEVER the amount.
 * These are the engine's OWN base magnitudes (one knob per signal-direction); the caller's `emphasis`
 * only picks a BOUNDED, CLAMPED multiplier (`CONSEQUENCE_EMPHASIS` below) of one of them. So widening
 * what the LLM may propose (open-set interpretation) never widens what it may magnitude (closed-set,
 * engine-owned — anti-sycophancy #3): a proposal can never pump an edge to flatter the player.
 *
 * Each direction names a member of the closed `EdgeSignals` space and its sign. `warmer`/`cooler`
 * move the affinity bond (with a small trust co-move, the shape `IMPACT.bonding`/`conflict` use);
 * the rest move one signal. Magnitudes sit in the same band as `IMPACT` (≈ a `notable` social beat),
 * so the generative path and the 7-way floor land in the same range — no back-door amplification.
 * `reliability` is intentionally NOT addressable here: it is evidence (E54), not a proposable vibe.
 */
export type ConsequenceDirection =
  | "warmer" | "cooler"
  | "more-trust" | "less-trust"
  | "more-threatened" | "less-threatened"
  | "more-aligned" | "less-aligned";

export const CONSEQUENCE_DIRECTION_IMPACTS: Record<ConsequenceDirection, Partial<EdgeSignals>> = {
  warmer: { affinity: +0.15, trust: +0.06 },
  cooler: { affinity: -0.15, trust: -0.06 },
  "more-trust": { trust: +0.12 },
  "less-trust": { trust: -0.12 },
  "more-threatened": { threat: +0.16 },
  "less-threatened": { threat: -0.12 },
  "more-aligned": { alignment: +0.14 },
  "less-aligned": { alignment: -0.14 },
};

/**
 * Emphasis → a BOUNDED, CLAMPED multiplier on the engine's OWN base (above). RELATIVE weight only:
 * the caller says "this mattered more/less," the engine decides how much that is. The band is tight
 * (≤ `strong`) so emphasis can never inflate a fold past the betrayal-shock range — the closed set
 * keeps authority over the amount (ADR 0005 / mandate #3).
 */
export const CONSEQUENCE_EMPHASIS: Record<"slight" | "notable" | "strong", number> = {
  slight: 0.6,
  notable: 1.0,
  strong: 1.4,
};

/**
 * Deal consequences (0039 + audit E43/E54): HONORING a promise is a real, bounded positive fold —
 * the protected party registers the kept word (trust/alignment up, plus the evidence signal).
 * Applied once per honoring binding action by `DealLedger.reconcile`; breaking already lands
 * `BETRAYAL_SHOCK` above. Magnitudes live here only (the B59 grep gate).
 */
export const DEAL_IMPACTS = {
  honored: { trust: +0.06, affinity: +0.03, alignment: +0.04, reliability: +0.1 } as Partial<EdgeSignals>,
} as const;

/**
 * Deal-DURATION betrayal scaling (feature 0109 — the single tunable home for "when do you turn?").
 * A break's seeded betrayal-shock (BETRAYAL_SHOCK, applied by `DealLedger.applyBreak`) is multiplied
 * by a bounded scale derived from how much NEGOTIATED life the deal had left — NEVER inlined at the
 * call site (the B59 grep gate). Closed-set, engine-owned (mandate #3 / ADR 0005): the model proposes
 * the open-set "how long" prose; these numbers are the engine's alone, so a proposal can never pump
 * the size of a betrayal. The Vault Wall holds: the scale is a hidden magnitude, never crossed to the
 * player or admin (the `expiresWeek` the player negotiated is a TERM, not this derived factor).
 *
 *   • `perWeekRemaining` — each whole week of remaining explicit term ADDS this much to the scale,
 *     so stabbing a freshly-renewed (many-weeks-left) ally hurts more than one about to lapse.
 *   • `maxScale` — the cap: remaining-life can amplify the shock at most this far (a bound, never a
 *     runaway). 1 + perWeekRemaining·weeksLeft, clamped to this.
 *   • `vagueSoften` — a `vague` (unspoken-term) deal's break folds a SOFTER shock by this factor
 *     (< 1): built-in ambiguity discounts the betrayal — no clean named term was violated.
 *
 * Identity floor: a no-duration / no-label break scales by 1.0 (`breakSeverityScale` returns 1),
 * so the pre-0109 fold is byte-identical (the calibration-neutrality proof).
 */
export const DEAL_DURATION = {
  perWeekRemaining: 0.2,
  maxScale: 1.6,
  vagueSoften: 0.6,
} as const;

/**
 * Feature 0088 — a derived carriage word from the live NPC→player edge.
 * A sibling of `relationshipLabel`, oriented at the player and delta-aware
 * (drift = warming / cooling / steady since a per-week anchor). Pure read,
 * no rng, never a stored label. Vault-safe: a word only, never a number.
 */
export const CURRENT_READ = {
  /** Bond thresholds for carriage words (bond = (trust + affinity) / 2). */
  toward: {
    warm: 0.6,      // ≥ warm  → "warm and open"
    friendly: 0.45, // ≥ friendly → "friendly"
    neutral: 0.3,   // ≥ neutral → "neutral"
    guarded: 0.15,  // ≥ guarded → "guarded"
    // else → "wary"
  } as const,
  /** How big a bond move counts as warming/cooling vs. steady. */
  driftEpsilon: 0.08,
  words: {
    warm: "warm and open",
    friendly: "friendly",
    neutral: "neutral",
    guarded: "guarded",
    wary: "wary",
  } as const,
} as const;
