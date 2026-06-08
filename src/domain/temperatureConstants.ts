import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Temperature & emotional-modifier constants — the SINGLE tunable module (0028).
 *
 * 0006 fixed the *shape* (a bounded per-moment temperature roll + a soul-sourced
 * emotional modifier, no Luck stat) and proved the calibration; this fixes *the
 * numbers* and puts them in one place so the game's "swing" retunes without
 * touching logic — the sibling to the relationship constants (0026) and
 * `richnessConfig.ts`.
 *
 * Defaults match 0006's calibration: a clear favorite wins a strong ~72% majority
 * but loses real upsets, and the engine NEVER protects the player. Temperature is
 * bounded — it adds surprise but never overrides hard rules (eligibility, the
 * Vault Wall) or archetype-grounded weighting.
 */
export interface OutcomeWeights {
  stat: number;
  temperature: number;
  emotion: number;
  throwPenalty: number;
  playSafePenalty: number;
}

export interface EmotionalConstants {
  /** The soul's stasis (decision 0001); 0.5 = calm baseline. */
  baseline: number;
  /** How hard circumstance + the temperature roll swing the modifier. */
  volatilityScale: number;
  /** How fast it settles back toward baseline when things calm (per calm moment). */
  meanReversionRate: number;
}

/** Per-variable weighting: temperature is NOT one global multiplier (0028 §4). */
export interface VariableWeights {
  outcome: number;
  expression: number;
  initiative: number;
  secretSurface: number;
  allianceShift: number;
  volatility: number;
}

export interface TemperatureConstants {
  bound: { min: number; max: number };
  variableWeights: VariableWeights;
  outcome: OutcomeWeights;
  emotional: EmotionalConstants;
  /** Hidden elements surface RARELY, gated by the roll — bounded low (a treat, not a flood). */
  hiddenSurfacingRate: number;
}

export const TEMPERATURE_CONSTANTS: TemperatureConstants = {
  bound: { min: -1, max: 1 },
  variableWeights: { outcome: 0.36, expression: 0.5, initiative: 0.4, secretSurface: 0.2, allianceShift: 0.3, volatility: 0.4 },
  // Calibrated so a clear stat favorite wins a strong majority but loses a real minority (0006).
  outcome: { stat: 1.0, temperature: 0.36, emotion: 0.2, throwPenalty: 1.5, playSafePenalty: 0.2 },
  emotional: { baseline: 0.5, volatilityScale: 0.5, meanReversionRate: 0.3 },
  hiddenSurfacingRate: 0.05,
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** One bounded, seeded temperature value (the per-moment roll). */
export function temperatureRoll(rng: RandomnessSource, c: TemperatureConstants = TEMPERATURE_CONSTANTS): number {
  return c.bound.min + rng.next() * (c.bound.max - c.bound.min);
}

export function withinTemperatureBounds(value: number, c: TemperatureConstants = TEMPERATURE_CONSTANTS): boolean {
  return value >= c.bound.min && value <= c.bound.max;
}

/**
 * The soul-sourced emotional modifier (0028 §5): a baseline that swings with
 * circumstance + temperature and MEAN-REVERTS toward baseline when calm. Passing
 * `circumstance = 0, temperature ≈ 0` is a calm moment — it settles toward
 * baseline. It is a competition input, never a fourth stat.
 */
export function emotionalModifier(
  current: number,
  circumstance: number,
  temperature: number,
  c: TemperatureConstants = TEMPERATURE_CONSTANTS,
): number {
  const swung = clamp01(current + (circumstance + temperature) * c.emotional.volatilityScale);
  return swung + (c.emotional.baseline - swung) * c.emotional.meanReversionRate;
}

/** Whether a hidden element surfaces this moment — true RARELY (bounded by `hiddenSurfacingRate`). */
export function hiddenSurfaces(rng: RandomnessSource, c: TemperatureConstants = TEMPERATURE_CONSTANTS): boolean {
  return rng.next() < c.hiddenSurfacingRate;
}
