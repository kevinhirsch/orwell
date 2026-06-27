/**
 * Feature 0091 — trigger secrets & house-event eruptions: the SINGLE tunable module (the
 * `SOCIETY` / `GOSSIP` / `CONFIDENCE` / `THREAD` sibling). Every magnitude the trigger engine
 * reads lives HERE — no magic number at a call site (the B59 constants grep gate covers this file
 * like its siblings). Each constant has a REAL consumer (audit E53 — no decorative knob):
 * `volatilityMint*` → `mintTriggerVolatility`; `maxTriggers`/`population` → `generateHiddenElements`;
 * `fireRate` + the strain/precipitant weights → `pressure`/`shouldFire`; `eruptionCapPerSeason` →
 * the orchestrator's per-season eruption cap; `oneShotKinds`/`reArmCooldownWeeks` → the per-kind
 * re-arm policy.
 *
 * All terms are BOUNDED. They decide ONLY *whether* a buried trigger exists, *whether/when* it fires,
 * and *which* eruption kind — never a hard rule and never the Vault Wall (the engine still owns the
 * seeded magnitude; the sealed trigger never crosses to the player, mandate #2). No number ever
 * reaches the player (anti-sycophancy, mandate #3).
 *
 * Calibration (the load-bearing guarantee): the trigger check draws ONLY on its own dedicated session
 * side-rng, and minting draws on the existing per-NPC hidden-element side-rng — never the shared tick
 * stream that resolves the seeded society/vote/comp spine. With `ORWELL_TRIGGERS` off (the default)
 * ZERO draws happen and the calibration harness is byte-identical.
 */

/** The PUBLIC eruption scene type a trigger maps to — a *type* of public blow-up, NOT the sealed cause. */
export type EruptionKind = "blow-up" | "showmance-detonation" | "mask-slips" | "meltdown";

/** Every eruption kind, the single source of truth (no hand-copied list). */
export const ERUPTION_KINDS: readonly EruptionKind[] = [
  "blow-up",
  "showmance-detonation",
  "mask-slips",
  "meltdown",
] as const;

export interface TriggerConstants {
  // ── minting (characterFactory): a volatile hidden element gets a charge + an eruption kind ──
  /** A minted trigger's `volatility` ∈ [volatilityMintMin, volatilityMintMax] — how easily it goes off. */
  volatilityMintMin: number;
  volatilityMintMax: number;
  /**
   * Per-NPC CAP on trigger elements (sparseness, the 0059 "≤2 ties" discipline): a house of ticking
   * bombs is noise, so most houseguests carry 0–1. The hidden-element minter never exceeds this many
   * triggers for one NPC.
   */
  maxTriggers: number;
  /**
   * Population SPARSENESS ∈ [0,1]: the per-NPC chance the minter even ATTEMPTS to place a trigger
   * (gated on the trigger side-rng). Bounded low so most of the cast is un-triggered — a few slow
   * fuses across a season, never a soap opera.
   */
  population: number;

  // ── the fire condition (triggers.ts `pressure`/`shouldFire`) ──
  /**
   * The FINAL gate multiplier (sibling to `hiddenSurfacingRate = 0.05`): the fire check is
   * `rng.next() < pressure × fireRate`. Bounded LOW so eruptions are rare even at high pressure — a
   * treat, not a flood. Temperature governs the SURPRISE (the player can't predict the exact moment).
   */
  fireRate: number;
  /**
   * STRAIN floor ∈ [0,1]: a houseguest whose computed strain sits below this is too calm to detonate —
   * `pressure` is forced to 0 (no fire), so the same trigger on a near-baseline soul never goes off.
   */
  strainFloor: number;
  /**
   * How much a rattled soul (`emotionalState` below the calm baseline of 0.5) contributes to strain.
   * Distance below baseline, doubled to [0,1], scaled by this. The charge the player CAN observe
   * accumulating (a rattled tone, a "wound tight" rumor).
   */
  distressWeight: number;
  /** How much the soul's live `volatility` contributes to strain (a volatile houseguest is wound tight). */
  volatilityStrainWeight: number;

  // ── the per-season eruption cap (orchestrator) ──
  /**
   * HARD per-season cap on eruptions (the 0059/0075 sparseness sibling): a few per season, never a
   * soap opera. Persisted (monotonic) so a reload never re-opens it. Tuned live against the UAT.
   */
  eruptionCapPerSeason: number;

  // ── the per-kind re-arm policy (spec open-Q #4) ──
  /**
   * Eruption kinds that are ONE-SHOT: a mask, once dropped, stays dropped — its `fired` flag is
   * permanent and it can never re-fire. A kind NOT listed here can re-arm after a cooldown if strain
   * rebuilds (a `blow-up`/`meltdown` can recur). VAULT-class policy — never surfaced.
   */
  oneShotKinds: readonly EruptionKind[];
  /**
   * The cooldown (in weeks) before a RE-ARMABLE trigger (a kind not in `oneShotKinds`) may fire again
   * after a fire — so a blow-up can't detonate two weeks running. Read against `lastFiredWeek`.
   */
  reArmCooldownWeeks: number;
}

export const TRIGGER: TriggerConstants = {
  // minting — a charge in the upper-middle band, capped + sparse so the house stays legible. With ~1.9
  // eligible volatile wordings per NPC, a 0.16 per-element arm chance leaves a CLEAR MINORITY (≈25-30%)
  // of the cast carrying an armed trigger — most houseguests are un-triggered (the 0059 "≤2 ties" sparseness).
  volatilityMintMin: 0.45,
  volatilityMintMax: 0.95,
  maxTriggers: 1,
  population: 0.16,

  // the fire condition — bounded LOW (a treat, not a flood; sibling to hiddenSurfacingRate = 0.05)
  fireRate: 0.04,
  strainFloor: 0.45,
  distressWeight: 0.7,
  volatilityStrainWeight: 0.5,

  // the season cap — a few earned eruptions, never a soap opera
  eruptionCapPerSeason: 3,

  // the re-arm policy — a slipped mask stays slipped; a blow-up/meltdown can recur after a cooldown
  oneShotKinds: ["mask-slips"],
  reArmCooldownWeeks: 2,
};
