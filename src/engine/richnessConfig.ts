/**
 * Tunable thresholds + simulation parameters for behavioral fidelity (0003).
 * Kept in one place so calibration is a single source of truth (the exact
 * surfacing rate etc. are open decisions — `bb-sim-spec.md` §16.2).
 */
export const RICHNESS = {
  /** Most social life is off-screen relative to the player (a strong majority). */
  MIN_OFFSCREEN_SHARE: 0.6,
  /** Distinct interaction types present over a season. */
  MIN_TYPE_DIVERSITY: 5,
  /** Hidden elements surface only rarely (share of moments). */
  MAX_SURFACING_RATE: 0.1,
  /** Never dump: at most this many hidden elements revealed in one moment. */
  MAX_REVEALS_PER_MOMENT: 1,
} as const;

export const SIM = {
  npcCount: 15,
  days: 28,
  momentsPerDay: 8,
  offscreenProb: 0.8,
  surfaceProb: 0.05,
  allianceThreshold: 0.5,
} as const;
