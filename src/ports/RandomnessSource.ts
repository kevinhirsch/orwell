/** Seedable randomness so every distribution/outcome is deterministically testable. */
export interface RandomnessSource {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Derive an independent child stream (per-moment temperature lives on forks). */
  fork(label: string): RandomnessSource;
}
