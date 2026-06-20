/**
 * In-game time of day + the nightly presence economy (ADR 0006). A PURE domain helper:
 * the five public day-phases, how the clock advances by PLAY (never a wall-clock), each
 * houseguest's character-driven bedtime, the awake-set predicate the house thins through,
 * the player's own qualitative rest read, and the hidden rest DEFICIT the competition fold
 * consumes. No I/O and — critically — no shared-stream randomness: a bedtime is DERIVED
 * deterministically from a houseguest's STATIC aptitudes (CHARACTER, never the soul/Vault),
 * so the seeded calibration spine (juryReach / UAT golden streams) stays byte-identical and
 * a bedtime is stable for the whole season (it is who they are, not a roll).
 *
 * The bound on "functionally infinite" scheming is diegetic (ADR 0006 §Principle 3): as the
 * clock rolls toward late-night, houseguests turn in at their own bedtime, the awake set
 * shrinks toward empty, and play runs out of PEOPLE — no mechanical curfew. The player is
 * never auto-slept (Principle 6); they choose when to turn in.
 */

/** The five PUBLIC day-phases (ADR 0006). Not a clock — a coarse, shared, Vault-free band. */
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night" | "late-night";

/** Phase order — the day runs front to back; `late-night` is the last phase before a new morning. */
export const TIME_OF_DAY_ORDER: readonly TimeOfDay[] = [
  "morning", "afternoon", "evening", "night", "late-night",
];

/** The day begins here (the morning after every night). */
export const DAY_START: TimeOfDay = "morning";

/** Public, natural display label for the time-of-day HUD (the morning→late-night graphic, no clock). */
export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
  "late-night": "Late night",
};

/** The player's OWN, qualitative rest read (ADR 0006 §Principle 5 — their own body, never a number). */
export type RestStatus = "rested" | "tired" | "running on empty";

/** Static aptitudes a bedtime is read off of (the CHARACTER `stats` — Vault-free, byte-stable). */
export interface BedtimeStats {
  physical: number;
  social: number;
}

export interface SleepConstants {
  /**
   * The "night-owl score" is `social − physical`: the social game stays up to scheme; the
   * comp-focused protect their sleep. A houseguest beds at `evening` below the early-sleeper
   * cut, at `late-night` above the night-owl cut (the rare tail), and at `night` in between.
   */
  earlySleeperBelow: number;
  nightOwlAbove: number;
  /**
   * The hidden rest DEFICIT (0..1) carried INTO a competition by how late one was up the night
   * before — the floor of the sleep→comp penalty (ADR 0006 §Principle 4). A houseguest sharp and
   * rested (bed by `evening`/`night`) carries none; a night-owl who ran to `late-night` carries the
   * most. Bounded; combined with the outcome `sleepPenalty` weight, never a raw number to the player.
   */
  deficitByLatestPhase: Record<TimeOfDay, number>;
}

export const SLEEP: SleepConstants = {
  earlySleeperBelow: -0.08,
  nightOwlAbove: 0.12,
  // Up through `night` is a healthy night; only pushing into `late-night` costs real sharpness.
  deficitByLatestPhase: {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0.25,
    "late-night": 1,
  },
};

/** Position of a phase in the day (0 = morning … 4 = late-night). */
export function phaseIndex(phase: TimeOfDay): number {
  return TIME_OF_DAY_ORDER.indexOf(phase);
}

/**
 * The next phase as the day rolls forward by PLAY. Clamps at `late-night` — the day does NOT
 * silently wrap to the next morning here; a new day begins only when the night actually ends
 * (the player turns in, or the house has emptied), via `rollToMorning`. So advancing the clock
 * can never skip past the late-night beat where the player's bedtime choice lives.
 */
export function nextPhase(phase: TimeOfDay): TimeOfDay {
  const i = phaseIndex(phase);
  return TIME_OF_DAY_ORDER[Math.min(i + 1, TIME_OF_DAY_ORDER.length - 1)]!;
}

/** Whether the day has reached its final, thinning hours (the bedtime decision becomes live here). */
export function isLateNight(phase: TimeOfDay): boolean {
  return phase === "late-night";
}

/**
 * The LATEST phase a houseguest stays awake to — their character-driven bedtime. DERIVED purely
 * from static aptitudes (the social game stays up, the comp-focused sleep), so it is byte-stable
 * for the season and draws NO randomness. A few houseguests are night owls (bed at `late-night`);
 * most bed at `night`; the comp-focused bed at `evening`.
 */
export function bedtimeFor(stats: BedtimeStats): TimeOfDay {
  const owlScore = stats.social - stats.physical;
  if (owlScore > SLEEP.nightOwlAbove) return "late-night";
  if (owlScore < SLEEP.earlySleeperBelow) return "evening";
  return "night";
}

/** Whether a houseguest with the given bedtime is still awake at this phase (awake through it, asleep after). */
export function isAwakeAt(phase: TimeOfDay, bedtime: TimeOfDay): boolean {
  return phaseIndex(phase) <= phaseIndex(bedtime);
}

/**
 * The awake set at a phase: the active houseguests still up. The PLAYER is always awake unless
 * they have chosen to turn in (never auto-slept — ADR 0006 §Principle 6). As the night gets late
 * this shrinks toward (at most) the player + the night owls — the diegetic bound.
 */
export function awakeSet(opts: {
  active: readonly string[];
  phase: TimeOfDay;
  player: string;
  playerRetired: boolean;
  bedtimeOf: (id: string) => TimeOfDay;
}): string[] {
  return opts.active.filter((id) =>
    id === opts.player ? !opts.playerRetired : isAwakeAt(opts.phase, opts.bedtimeOf(id)),
  );
}

/**
 * The hidden rest deficit (0..1) a houseguest carries into a competition, from the latest phase
 * they were awake the night before. Slice-2 input to the comp fold; never surfaced as a number.
 */
export function restDeficitFor(latestPhaseAwake: TimeOfDay): number {
  return SLEEP.deficitByLatestPhase[latestPhaseAwake];
}

/**
 * The player's OWN qualitative tiredness, from how late they stayed up. Their own body is their
 * own knowledge (ADR 0006 §Principle 5) — a cue, never a number, and never any NPC's state.
 */
export function restStatusFor(latestPhaseAwake: TimeOfDay): RestStatus {
  if (isLateNight(latestPhaseAwake)) return "running on empty";
  if (latestPhaseAwake === "night") return "tired";
  return "rested";
}
