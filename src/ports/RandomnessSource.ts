/**
 * Seedable source of determinism. All variance (competition outcomes, the per-moment
 * temperature roll, the veto draw) flows through this port so behaviour is reproducible
 * under a fixed seed (features 0005, 0006).
 */
export interface RandomnessSource {
  /** Returns a float in [0, 1). Deterministic given the seed. */
  next(): number;
}
