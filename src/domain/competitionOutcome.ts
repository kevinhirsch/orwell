import type { EntityId } from "./ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { TEMPERATURE_CONSTANTS } from "./temperatureConstants";
import type { TemperatureConstants } from "./temperatureConstants";

/**
 * Competition resolution: outcomes are earned, never story convenience. A score
 * is the relevant stat (vs. the competition type) + a per-moment temperature roll
 * + a soul-sourced emotional modifier (NO Luck stat) + the declared intent. The
 * engine never special-cases the player. Deterministic under a fixed seed.
 * Weights are tunable config (the exact math is an open decision, spec §16.2).
 */
export type CompetitionType = "endurance" | "physical" | "puzzle" | "quiz" | "memory" | "mental" | "social";
export type Intent = "compete" | "throw" | "play-safe";

export interface Competitor {
  id: EntityId;
  stats: { physical: number; mental: number; social: number };
  /** 0..1 from the dynamic soul; 0.5 = baseline. A rattled houseguest competes differently. */
  emotionalState?: number;
}

const RELEVANT: Record<CompetitionType, "physical" | "mental" | "social"> = {
  endurance: "physical", physical: "physical",
  puzzle: "mental", quiz: "mental", memory: "mental", mental: "mental",
  social: "social",
};

/**
 * Calibrated so a clear stat favorite wins a strong majority but loses a real
 * minority. The numbers now live in the single tunable module (0028); this is a
 * re-export so existing importers keep working.
 */
export const OUTCOME_WEIGHTS = TEMPERATURE_CONSTANTS.outcome;

export interface CompetitionResult {
  winner: EntityId;
  scores: Record<EntityId, number>;
  temperature: Record<EntityId, number>;
}

/** Declared before a competition; immutable once the result is given. */
export class CompetitionIntents {
  private locked = false;
  private readonly map = new Map<EntityId, Intent>();

  declare(id: EntityId, intent: Intent): void {
    if (this.locked) throw new Error("competition intent is immutable after the result is given");
    this.map.set(id, intent);
  }

  lock(): void {
    this.locked = true;
  }

  intentOf(id: EntityId): Intent {
    return this.map.get(id) ?? "compete";
  }
}

export function resolveCompetition(
  competitors: Competitor[],
  type: CompetitionType,
  intents: CompetitionIntents,
  rng: RandomnessSource,
  /** Tunable temperature/outcome constants (0028); defaults to the single module. */
  constants: TemperatureConstants = TEMPERATURE_CONSTANTS,
): CompetitionResult {
  const stat = RELEVANT[type];
  const w = constants.outcome;
  const span = constants.bound.max - constants.bound.min;

  // One bounded temperature draw per competitor, in array order (seed-reproducible).
  const temperature: Record<EntityId, number> = {};
  for (const c of competitors) temperature[c.id] = constants.bound.min + rng.next() * span;

  const scores: Record<EntityId, number> = {};
  for (const c of competitors) {
    const base = c.stats[stat] * w.stat;
    const temp = temperature[c.id]! * w.temperature;
    const emo = ((c.emotionalState ?? 0.5) - 0.5) * 2 * w.emotion;
    const intent = intents.intentOf(c.id);
    const intentAdj =
      intent === "throw" ? -w.throwPenalty
      : intent === "play-safe" ? -w.playSafePenalty
      : 0;
    scores[c.id] = base + temp + emo + intentAdj;
  }

  let winner = competitors[0]!.id;
  for (const c of competitors) if (scores[c.id]! > scores[winner]!) winner = c.id;

  intents.lock(); // the result is now given — intents can no longer change
  return { winner, scores, temperature };
}
