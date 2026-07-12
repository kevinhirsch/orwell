/**
 * Feature #1400 — GENERATIVE COMPETITION DESIGN: the single tunable module (like `imageConstants.ts` /
 * the temperature constants). The model AUTHORS each week's competition theme + premise + per-round
 * elimination fiction OVER the engine's ALREADY-FIXED roll — it dresses a decided result, it can never
 * touch it. Every number/bound/flag that governs the feature lives here so tuning is one file.
 *
 * THE SAFETY PROPERTY (why this is approvable): a staged competition resolves as ONE calibrated
 * `resolveCompetition` roll UP FRONT — the crown and the full drop order are fixed BEFORE any staging
 * renders (`liveSeason.ts` `advanceCompetition` + `competitionOutcome.ts`; `stagedTrajectoryNeutral.test.ts`
 * is the byte-identity guard). Generation happens AFTER the roll, PRESENTATION-ONLY, so it can never
 * perturb the winner, the drop order, or any downstream seeded roll. Validation is HARD: every
 * elimination named in the authored fiction must map to the engine's fixed drop order EXACTLY; on any
 * mismatch the write-back is REJECTED and the deterministic 0042 competition-library floor stands (the
 * library remains the test/CI floor). Never let generated fiction rename who goes or in what order.
 */

/**
 * The runtime flag. DEFAULT OFF (opt-in): absent/`0`/`false` ⇒ the fiction write-back is refused, no
 * fiction is ever stored, and EVERYTHING is byte-identical to the pre-feature 0042-library model (the
 * `genCompetition` outcome-neutrality proof + `stagedTrajectoryNeutral` byte-identity both pin this).
 * Turn ON per deployment with `ORWELL_GEN_COMPETITIONS=1`; the adapter also exposes a
 * `setGenCompetitionsEnabled` setter (used by tests) so the switch is flippable without a restart.
 */
export const GEN_COMPETITIONS_ENV = "ORWELL_GEN_COMPETITIONS";

/** Read the env default for the flag (unset ⇒ OFF). The adapter reads this once at construction. */
export function genCompetitionsEnvDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[GEN_COMPETITIONS_ENV] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * The MODEL CLASS + COST CAP the FE driver honors (documented here; the FE driver enforces it).
 * The fiction author is a background UTILITY completion — the same tier the 0062 zeitgeist / 0058
 * cast-authoring write-backs use (`orwell_cast_authoring._resolve_llm_fn`), never the premium narrator.
 *
 * COST CAP: exactly ONE utility call per competition, so at most ~2/week (one HOH + one veto). The FE
 * driver is fire-and-forget, idempotent (a per-comp in-flight guard), and fail-soft — no model, no
 * usable output, or a rejected write-back ⇒ the deterministic 0042 floor simply stands.
 */
export const GEN_COMPETITION_MODEL_CLASS = "utility" as const;
export const GEN_COMPETITION_CALLS_PER_COMP = 1;

/**
 * Sanitization bounds for the authored text (defense-in-depth — the engine trims, like the zeitgeist
 * slice caps). Flavor, not an almanac: a short theme, a couple of premise sentences, one line per drop.
 */
export const GEN_COMPETITION_BOUNDS = {
  /** Max chars for the invented competition theme/name (e.g. "The Gauntlet of Whispers"). */
  maxThemeLen: 120,
  /** Max chars for the staging premise (how the comp is set up + played). */
  maxPremiseLen: 600,
  /** Max chars for the "how a win reads" line. */
  maxWinReadsLen: 240,
  /** Max chars for a single per-elimination fiction line. */
  maxFictionLen: 300,
} as const;
