import type { CompetitionType } from "../domain/competitionOutcome";
import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Feature 0042 — the competition library: a seeded, CURATED set of competition definitions so a
 * season has real, structured variety. Each def names the comp, declares WHICH aptitude governs it
 * (explicitly — the def's `type` routes into the existing 0006/0028 resolution math, unchanged),
 * and carries a Vault-free narrative scaffold the narrator (0018) dresses — premise, beats, and how
 * a win reads. The library NEVER picks a winner (anti-sycophancy): `resolveCompetition` still
 * decides from stats + bounded temperature + the soul emotional modifier + intent.
 *
 * Tunable content, like `richnessConfig` / the temperature constants: add or reword defs freely —
 * the tests pin the structure (governing === the resolution map's stat for the def's type; ids
 * unique; both phases stocked), not the flavor.
 */
export type CompetitionPhase = "hoh" | "veto";
export type CompetitionFormat = "endurance" | "puzzle" | "quiz" | "skill" | "crapshoot" | "social";
export type Aptitude = "physical" | "mental" | "social";

/** The Vault-free narrative scaffold (0018): flavor only — no stats, no scores, no hidden state. */
export interface CompetitionNarrative {
  premise: string;
  beats: string[];
  winReads: string;
}

export interface CompetitionDef {
  id: string;
  name: string;
  phase: CompetitionPhase;
  /** The existing resolution type (0006) — `RELEVANT[type]` IS this comp's governing aptitude. */
  type: CompetitionType;
  /** The governing aptitude, explicit (pinned to `RELEVANT[type]` by test — never drifts). */
  governing: Aptitude;
  /** Narrative flavor only — a secondary read the scaffold mentions; resolution math unchanged. */
  secondary?: Aptitude;
  format: CompetitionFormat;
  narrative: CompetitionNarrative;
}

export const COMPETITION_LIBRARY: CompetitionDef[] = [
  // --- HOH competitions -----------------------------------------------------------------
  {
    id: "hoh-wall", name: "Hold the Wall", phase: "hoh", type: "endurance", governing: "physical",
    format: "endurance",
    narrative: {
      premise: "The houseguests grip a narrow ledge on a slowly tilting wall over the yard.",
      beats: ["the wall pitches forward and the first grips fail", "cold water sprays the holdouts", "two are left white-knuckled as the house chants"],
      winReads: "a war of attrition — the winner simply refused to drop",
    },
  },
  {
    id: "hoh-quiz", name: "House History", phase: "hoh", type: "quiz", governing: "mental", secondary: "social",
    format: "quiz",
    narrative: {
      premise: "Buzzer podiums in the living room: rapid-fire questions about what really happened this season.",
      beats: ["an easy opener lulls the field", "a brutal detail question splits the leaders", "sudden-death on the final buzzer"],
      winReads: "whoever was paying the closest attention all along",
    },
  },
  {
    id: "hoh-maze", name: "Night Maze", phase: "hoh", type: "memory", governing: "mental",
    format: "puzzle",
    narrative: {
      premise: "The yard is a blacked-out maze; each houseguest got one daylight walkthrough to memorize.",
      beats: ["the first wrong turns echo in the dark", "someone retraces from the start rather than guess", "a sprint to the glowing exit gate"],
      winReads: "a cool head holding a perfect mental map",
    },
  },
  {
    id: "hoh-haul", name: "The Long Haul", phase: "hoh", type: "physical", governing: "physical",
    format: "skill",
    narrative: {
      premise: "Carry sandbags across a greased balance beam to tip your scale before anyone else.",
      beats: ["early haulers slip and restart", "a steady rhythm emerges", "the leading scale creaks toward the buzzer"],
      winReads: "raw strength married to patience",
    },
  },
  {
    id: "hoh-count", name: "Count the House", phase: "hoh", type: "mental", governing: "mental",
    format: "puzzle",
    narrative: {
      premise: "Estimate the uncountable: jellybeans in a tub, seconds of a silent timer, steps in a montage.",
      beats: ["wild guesses scatter the board", "the cautious mid-range answers cluster", "the closest call takes the round"],
      winReads: "a calculating mind that refuses to panic",
    },
  },
  {
    id: "hoh-read", name: "Read the Room", phase: "hoh", type: "social", governing: "social",
    format: "social",
    narrative: {
      premise: "Predict, one by one, how the rest of the house answered anonymous questions about each other.",
      beats: ["a safe early read lands", "a shock answer exposes who knows whom", "the last prediction decides it"],
      winReads: "the houseguest who actually knows this house",
    },
  },
  // --- Veto competitions ----------------------------------------------------------------
  {
    id: "veto-lock", name: "Lock and Key", phase: "veto", type: "puzzle", governing: "mental",
    format: "puzzle",
    narrative: {
      premise: "Six locked boxes, hundreds of keys, one veto medallion — sort, test, and think under the clock.",
      beats: ["key piles collapse into chaos", "someone starts sorting instead of jamming", "the final lock clicks open"],
      winReads: "method beating frenzy",
    },
  },
  {
    id: "veto-whisper", name: "Whisper Network", phase: "veto", type: "social", governing: "social",
    format: "social",
    narrative: {
      premise: "Match each overheard houseguest quote to who said it — and to whom.",
      beats: ["the obvious quotes go fast", "a misattributed whisper costs a leader", "the deepest socializer pulls ahead"],
      winReads: "proof of who really listens in this house",
    },
  },
  {
    id: "veto-faces", name: "Face the Facts", phase: "veto", type: "memory", governing: "mental",
    format: "quiz",
    narrative: {
      premise: "Composite portraits flash for seconds: name the two houseguests blended in each.",
      beats: ["easy blends fall quickly", "a near-identical pair stalls everyone", "a lightning round settles it"],
      winReads: "a photographic memory under pressure",
    },
  },
  {
    id: "veto-hands", name: "Steady Hands", phase: "veto", type: "physical", governing: "physical", secondary: "mental",
    format: "skill",
    narrative: {
      premise: "Stack a card house on a wobbling table while the house is allowed to heckle.",
      beats: ["first towers collapse to jeers", "a slow builder ignores the noise", "one final card placed at full stretch"],
      winReads: "nerve and fine control, not brute force",
    },
  },
  {
    id: "veto-scramble", name: "House Scramble", phase: "veto", type: "puzzle", governing: "mental",
    format: "crapshoot",
    narrative: {
      premise: "A chaotic yard-wide scavenger scramble for hidden veto letters — part plan, part pandemonium.",
      beats: ["everyone sprints somewhere different", "two houseguests fight over the same hiding spot", "the last letter surfaces in plain sight"],
      winReads: "a scramble where keeping your head counted double",
    },
  },
  {
    id: "veto-hang", name: "Hang Tough", phase: "veto", type: "endurance", governing: "physical",
    format: "endurance",
    narrative: {
      premise: "Dangle from swinging rings over foam while the rig speeds up every minute.",
      beats: ["the first drops come early", "the rig jerks and thins the field", "two grips outlast the speed setting"],
      winReads: "whoever wanted it badly enough to hurt for it",
    },
  },
];

/**
 * How many most-recent draws (per phase) the next draw must avoid — no immediate repeats.
 *
 * NOTE (COMP-4/BB-8, audit 2026-07-03): widening this (e.g. to 3) would meaningfully cut short-
 * interval verbatim repeats over an 11-week season, but it changes WHICH def a fixed seed draws each
 * week — and because the drawn def's `type` selects the resolution stat, that can flip an HOH/veto
 * winner for a fixed seed, cascading into a different nomination/eviction trajectory. Confirmed live:
 * bumping this to 3 broke the single-fixed-seed `emergent_blocs` BDD scenario (0043) by changing which
 * seed held HOH. Deferred — needs either a seed-tolerant rewrite of the affected fixed-seed tests or a
 * dedicated calibration re-measurement pass, not a one-line bump. See docs/audits/2026-07-03-final-
 * pre-ship-audit/lanes/comp-variety.md COMP-4 for the fuller variety options (growing the pool is
 * lower-risk than narrowing the repeat window).
 */
export const NO_REPEAT_WINDOW = 1;

/** Library lookup by id (e.g. a deferred veto resuming the comp it already drew). */
export function competitionById(id: string): CompetitionDef | undefined {
  return COMPETITION_LIBRARY.find((d) => d.id === id);
}

/**
 * Deterministically draw the week's competition for a phase: the seeded rng picks from the phase's
 * pool, avoiding the last `NO_REPEAT_WINDOW` used (variety, reproducibly by seed). PURE — the
 * caller owns `recent` (persisted with the season, 0030) and records the draw when the comp
 * actually resolves.
 */
export function drawCompetition(
  phase: CompetitionPhase, week: number, rng: RandomnessSource, recent: readonly string[] = [],
): CompetitionDef {
  const pool = COMPETITION_LIBRARY.filter((d) => d.phase === phase);
  const avoid = new Set(recent.slice(-NO_REPEAT_WINDOW));
  const candidates = pool.filter((d) => !avoid.has(d.id));
  const from = candidates.length > 0 ? candidates : pool; // a one-def pool can only repeat
  return from[rng.int(from.length)]!;
}
