import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Per-moment temperature: a roll across ALL involved variables, bounded. Governs
 * variance/surprise but never overrides hard rules. Exact distribution/bounds are
 * a tunable open decision (`bb-sim-spec.md` §16.2) — kept here as config.
 */
export const TEMPERATURE_BOUNDS = { min: -1, max: 1 } as const;

export function rollFor(variables: readonly string[], rng: RandomnessSource): Record<string, number> {
  const span = TEMPERATURE_BOUNDS.max - TEMPERATURE_BOUNDS.min;
  const out: Record<string, number> = {};
  for (const v of variables) out[v] = TEMPERATURE_BOUNDS.min + rng.next() * span;
  return out;
}

export function withinBounds(value: number): boolean {
  return value >= TEMPERATURE_BOUNDS.min && value <= TEMPERATURE_BOUNDS.max;
}
