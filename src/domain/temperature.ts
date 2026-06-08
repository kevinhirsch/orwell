import type { RandomnessSource } from "../ports/RandomnessSource";
import { TEMPERATURE_CONSTANTS, temperatureRoll, withinTemperatureBounds } from "./temperatureConstants";

/**
 * Per-moment temperature: a roll across ALL involved variables, bounded. Governs
 * variance/surprise but never overrides hard rules. The bound + distribution now
 * live in the single tunable constants module (`temperatureConstants.ts`, 0028);
 * this keeps the original helpers as a thin, behavior-preserving facade.
 */
export const TEMPERATURE_BOUNDS = TEMPERATURE_CONSTANTS.bound;

export function rollFor(variables: readonly string[], rng: RandomnessSource): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of variables) out[v] = temperatureRoll(rng);
  return out;
}

export function withinBounds(value: number): boolean {
  return withinTemperatureBounds(value);
}
