import { classify } from "../domain/event";
import { PLAYER } from "../domain/ids";
import type { SeasonResult } from "./simulation";

/** Behavioral-fidelity metrics computed over a simulated season. */
export interface RichnessMetrics {
  totalMoments: number;
  /** Fraction of interactions the player did not witness (from the EventStore). */
  offscreenShare: number;
  typeDiversity: number;
  types: string[];
  alliancesFormed: number;
  alliancesFractured: number;
  edgeStrengthsChanged: boolean;
  /** Share of moments that revealed a hidden element. */
  surfacingRate: number;
  maxRevealsPerMoment: number;
  totalReveals: number;
}

export function richnessMetrics(result: SeasonResult): RichnessMetrics {
  // Off-screen share + type diversity read from the EventStore via the real
  // visibility model (feature 0002) — off-screen = the player is not a witness.
  const events = result.events.query();
  const offscreen = events.filter((e) => classify(e, PLAYER) === "HIDDEN").length;
  const types = [...new Set(events.map((e) => e.type))];

  const reveals = result.moments.map((m) => m.reveals);
  const totalReveals = reveals.reduce((a, b) => a + b, 0);
  const momentsWithReveal = result.moments.filter((m) => m.reveals > 0).length;

  return {
    totalMoments: result.moments.length,
    offscreenShare: events.length === 0 ? 0 : offscreen / events.length,
    typeDiversity: types.length,
    types,
    alliancesFormed: result.alliancesFormed,
    alliancesFractured: result.alliancesFractured,
    edgeStrengthsChanged: result.edgeStrengthsChanged,
    surfacingRate: result.moments.length === 0 ? 0 : momentsWithReveal / result.moments.length,
    maxRevealsPerMoment: reveals.length === 0 ? 0 : Math.max(...reveals),
    totalReveals,
  };
}
