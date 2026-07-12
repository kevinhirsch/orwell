import { HIDDEN_ELEMENT_RANGE } from "./characterFactory";
import { DEFAULT_TIE_BUDGET } from "./seededRelationships";

/**
 * Feature 0116 — model-authored cast genesis: the SINGLE tunable module for the engine's validation
 * ENVELOPE (the 0028 `temperatureConstants.ts` precedent). The model proposes the whole 15-NPC
 * skeleton; the engine OWNS the numbers. Every bound the envelope enforces lives here so the "how much
 * anything weighs" line (ADR 0005, generalized to world-gen) retunes without touching envelope logic.
 *
 * These are the §9 open-decision #2 constants, firmed at build with sensible defaults. Because the
 * SEEDED calibration/heavy sims run on the deterministic FLOOR (no model ⇒ no proposal ⇒ this module is
 * never consulted — see the byte-neutrality gate in §7/§8), NONE of these values move a shipped
 * calibration gate. They are tuned instead against the genesis-shaped property gate (§8 — the
 * `EARNED_WINS` analog over envelope-PASSING casts), which is the only sim that plays a committed
 * genesis cast. Do NOT wire these into the floor.
 */

// ── Banded VARIABLE stat totals (§3 "Stats"; the envelope's centerpiece) ──────────────────────────
/**
 * The engine's REFERENCE MAXIMUM total, on the sum-of-three [0,1]³ stat scale (physical + mental +
 * social). Pinned at build. A top-of-band NPC averages `GENESIS_TOTAL_MAX / 3` per stat; the band edge
 * below opens the floor for genuine floaters. Chosen a touch above today's archetype-table ceiling (the
 * strongest floor archetype totals ~1.8) so a committed genesis cast admits a WIDER power spread than
 * the floor — "real comp beasts AND real floaters exist by design" (§3). Tunable against the §8 gate.
 */
export const GENESIS_TOTAL_MAX = 2.1;

/** The band is `[GENESIS_TOTAL_BAND_FLOOR_FRACTION × max, max]` — default 70–100% of the reference max (§3). */
export const GENESIS_TOTAL_BAND_FLOOR_FRACTION = 0.7;

/** The committed stat-total band `[lo, hi]` on the [0,1]³ scale. A proposal's total is clamped/renormalized inside it — no model number escapes (§8). */
export const GENESIS_TOTAL_BAND: { lo: number; hi: number } = {
  lo: GENESIS_TOTAL_BAND_FLOOR_FRACTION * GENESIS_TOTAL_MAX, // 1.47
  hi: GENESIS_TOTAL_MAX, // 2.1
};

/** Per-stat clamp `[min, max]` (§3): every committed stat sits inside this before/after total renormalization. */
export const GENESIS_STAT_CLAMP: { min: number; max: number } = { min: 0.2, max: 0.9 };

/**
 * Cast-wide VARIANCE FLOOR (§3/§8): the committed cast must clear a real dispersion of totals AND of
 * each stat across the 15 NPCs — no super-cast, no dud-cast, no fifteen identical mid-liners. Measured as
 * the population standard deviation. A flat cast has ~0 dispersion; a genuinely varied one clears these
 * comfortably. A cast-wide failure re-rolls the cast slice (it is NOT clamped in place — flatness can only
 * be fixed by re-proposing).
 */
export const GENESIS_VARIANCE_FLOOR = {
  /** Min population stdev of the 15 stat TOTALS (the band spans 0.63 ⇒ a real spread clears this). */
  totalStdev: 0.08,
  /** Min population stdev of EACH stat (physical/mental/social) across the cast. */
  perStatStdev: 0.08,
} as const;

// ── Hidden elements (§3 "Hidden elements") — the count range is the characterFactory single source ──
/** Per-NPC hidden-element count range (3–6) — re-exported from the floor so genesis and floor never diverge (§3). */
export const GENESIS_HIDDEN_ELEMENT_RANGE = HIDDEN_ELEMENT_RANGE;

// ── Pre-show tie graph (§3 "Pre-show tie graph") — sparse by design (0059) ─────────────────────────
/** Max pre-show ties the genesis proposal may carry (0059's sparseness budget; 0–2, sparse by design). Excess is dropped/re-rolled. */
export const GENESIS_TIE_BUDGET = DEFAULT_TIE_BUDGET; // 2

// ── Bounded re-roll (§4) ───────────────────────────────────────────────────────────────────────────
/**
 * The re-roll budget N (§4/§9): how many bounded re-roll attempts the FE driver echoes violations into
 * before the strict/floor fork. The ENGINE returns structured violations every attempt; N is the FE
 * driver's loop bound. Exposed here so the driver and the tests read one number. (The engine chassis
 * does not itself loop — it validates + commits + reports; the follow-on FE driver owns the loop.)
 */
export const GENESIS_MAX_REROLLS = 3;

// ── The seeded SEASON BRIEF (§2 DECIDED #5) — engine-owned, finite, seed-derived dimension pools ────
/**
 * The brief STEERS the model's open-ended generation (a demographic skew, a regional flavor, an ensemble
 * vibe) and is derived ONLY from the seed on a dedicated side-stream — so same seed ⇒ same brief
 * (replayable) and different seeds steer different casting directions. The dimension space is finite, so
 * distinct seeds can occasionally deal a similar brief — the brief steers variety, it is not a
 * uniqueness guarantee (§2). Player-blind like everything else in genesis. The brief NEVER binds a
 * validator (only the engine's own caps/floors/bands bind, §3) — it is creative steering (open set).
 */
export const BRIEF_DEMOGRAPHIC_SKEWS: readonly string[] = [
  "skew younger — a twenties-heavy house with something to prove",
  "skew older — a cast of established adults with real lives on pause",
  "a wide age range, early-twenties up through the fifties",
  "a mostly-thirties professional class at a crossroads",
  "a youth-forward house with a couple of seasoned outliers",
  "an evenly-mixed generational spread, no dominant cohort",
];

export const BRIEF_REGIONAL_FLAVORS: readonly string[] = [
  "a heavy Gulf-coast contingent",
  "a Pacific-Northwest-leaning cast",
  "a Northeast-urban skew",
  "a Midwest-heartland core",
  "a Southern-heavy house",
  "a coast-to-coast spread with no regional center",
  "a Mountain-West and desert-Southwest lean",
  "a mix of small-town roots and big-city transplants",
];

export const BRIEF_ENSEMBLE_VIBES: readonly string[] = [
  "a house built for slow-burn grudges",
  "a loud, clash-forward ensemble that never lets a fight rest",
  "a warm, alliance-heavy crew that bonds fast and hard",
  "a cerebral, strategy-first cast that plays quiet",
  "a chaotic, unpredictable mix where nothing holds",
  "a status-hungry room full of people used to being the main character",
  "an underdog-heavy house of people written off before",
  "a showmance-prone cast with romance in the air",
];
