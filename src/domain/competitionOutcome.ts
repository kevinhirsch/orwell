import type { EntityId } from "./ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { rollFor } from "./temperature";

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

/** Calibrated so a clear stat favorite wins a strong majority but loses a real minority. */
export const OUTCOME_WEIGHTS = {
  stat: 1.0,
  temperature: 0.36,
  emotion: 0.2,
  throwPenalty: 1.5,
  playSafePenalty: 0.2,
} as const;

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
): CompetitionResult {
  const stat = RELEVANT[type];
  const temperature = rollFor(competitors.map((c) => c.id), rng);

  const scores: Record<EntityId, number> = {};
  for (const c of competitors) {
    const base = c.stats[stat] * OUTCOME_WEIGHTS.stat;
    const temp = temperature[c.id]! * OUTCOME_WEIGHTS.temperature;
    const emo = ((c.emotionalState ?? 0.5) - 0.5) * 2 * OUTCOME_WEIGHTS.emotion;
    const intent = intents.intentOf(c.id);
    const intentAdj =
      intent === "throw" ? -OUTCOME_WEIGHTS.throwPenalty
      : intent === "play-safe" ? -OUTCOME_WEIGHTS.playSafePenalty
      : 0;
    scores[c.id] = base + temp + emo + intentAdj;
  }

  let winner = competitors[0]!.id;
  for (const c of competitors) if (scores[c.id]! > scores[winner]!) winner = c.id;

  intents.lock(); // the result is now given — intents can no longer change
  return { winner, scores, temperature };
}
