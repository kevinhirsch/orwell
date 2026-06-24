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
  // Up through `night` is a healthy night (ENG-NEW-1: was 0.25, contradicting this very comment);
  // only pushing into `late-night` — staying up to the bitter end — costs real sharpness.
  deficitByLatestPhase: {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
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

// --- Continuous "night depth" (0066 Phase-2; gated) -----------------------------------------------
//
// The 5 phases are too coarse to grade the sleep trade or vary bedtimes by character. A hidden,
// continuous `nightDepth` (0 = start of morning … 1 = the bitter end of late-night) carries that
// richness; the PUBLIC surface stays the same 5-phase enum, PROJECTED via `phaseForDepth` (the FE/HUD
// is unchanged). All ENGINE-only and only ever non-zero when the opt-in clock is running, so the
// seeded calibration spine stays byte-identical (depth absent ⇒ 0 ⇒ every helper below returns its
// pre-feature value). No rng anywhere here — a bedtime is DERIVED, never rolled.

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Project the hidden depth (0..1) onto the public 5-phase band — even fifths, `late-night` last. */
export function phaseForDepth(depth: number): TimeOfDay {
  const i = Math.min(TIME_OF_DAY_ORDER.length - 1, Math.floor(clamp(depth, 0, 1) * TIME_OF_DAY_ORDER.length));
  return TIME_OF_DAY_ORDER[i]!;
}

/** A small deterministic string→[0,1) hash (FNV-1a; NO rng, NO imports) for per-NPC chronotype spread. */
function hashUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * A houseguest's CHRONOTYPE turn-in DEPTH (0..1): how deep into the night they stay before bed. It is
 * its OWN axis — the `social − physical` lean (the social game stays up; the comp-focused protect sleep)
 * blended with a DETERMINISTIC per-NPC variation hashed off the id — so two similar-stat houseguests
 * still differ, yet a bedtime is byte-stable for the season and draws no randomness. Maps to roughly
 * `evening` for the earliest birds → deep `late-night` for the strongest owls. With no `id` (the legacy
 * call shape) the chronotype variation is omitted — a pure function of stats, stable as before.
 */
export function bedtimeDepthFor(stats: BedtimeStats, id?: string): number {
  const lean = clamp((stats.social - stats.physical) / 0.5, -1, 1); // social → owl (+), comp-focused → early (−)
  const jitter = id ? hashUnit(id) * 2 - 1 : 0;                     // deterministic per-NPC spread, ∈ [−1, 1)
  const chrono = clamp(0.6 * lean + 0.4 * jitter, -1, 1);
  return 0.45 + ((chrono + 1) / 2) * 0.5;                           // ∈ [0.45, 0.95]: evening → deep late-night
}

/**
 * The GRADED hidden rest deficit (0..1) carried into a competition by how deep into the night one was up
 * (the continuous replacement for the binary `SLEEP.deficitByLatestPhase`). A healthy night (bed by the
 * end of `night`, depth ≤ 0.8) carries NONE — preserving the ENG-NEW-1 fairness invariant (no archetype
 * sleep tax on a normal night) — and the cost ramps only WITHIN `late-night` (0.8 → 1.0), so the deeper
 * into the small hours you ran, the more it bites. Bounded; combined with the outcome `sleepPenalty`
 * weight, never a raw number to the player.
 */
export function restDeficitForDepth(depth: number): number {
  return clamp((depth - 0.8) / 0.2, 0, 1); // 0 through `night` (≤0.8) → 1 at the bitter end (1.0)
}

// 0066 Phase-2: a tired houseguest is less able to MOVE THE NEEDLE socially — the magnitude of the
// relationship fold their scenes drive on others is dampened (EFFECTIVENESS, never a personality change:
// the scene's nature is unchanged, only how far it shifts the other's belief). Floored so even a wrecked
// houseguest still has SOME sway. `SOCIAL_SWAY_DAMP` = the dampening at a full deficit.
export const SOCIAL_SWAY_DAMP = 0.6;
export const SOCIAL_SWAY_FLOOR = 0.4;

/** The fold-magnitude scale (≤1) for a houseguest carrying `deficit` rest debt. 1 at deficit 0 (rested ⇒
 *  byte-identical), dropping to the floor at a full deficit. Symmetric: worse at warming AND at souring. */
export function socialSwayScale(deficit: number): number {
  return Math.max(SOCIAL_SWAY_FLOOR, 1 - SOCIAL_SWAY_DAMP * clamp(deficit, 0, 1));
}
