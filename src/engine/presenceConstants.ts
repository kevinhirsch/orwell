/**
 * Presence & overhearing tunables (feature 0049) — the single home for every number the
 * presence layer uses, in the 0026/0028 constants-module pattern (no magic numbers inline;
 * a future God-Mode knob).
 */
export interface PresenceConstants {
  /**
   * Chance a resolved scene is overheard AT ALL (one roll per scene, one ear when it opens).
   * Deliberately low: an overhear is a rare, special beat — and every success is a recorded
   * propagation event, so volume also costs persistence (the per-commit snapshot scales with
   * the event store).
   */
  overhearProb: number;
  /** Chance a houseguest moves rooms on a tick at all (otherwise they stay put). */
  moveProb: number;
  /** Weight of affinity toward already-placed occupants when choosing a room. */
  affinityPull: number;
  /** How strongly the HOH gravitates to the HOH room. */
  hohRoomPull: number;
  /** Confidence carried by an overheard fact (a witness's is full/unset; this is partial). */
  overhearConfidence: number;
  /** Fraction of a scene's content an overhearer catches (NEVER 1 — through a wall, not a transcript). */
  overhearFraction: number;
}

export const PRESENCE: PresenceConstants = {
  overhearProb: 0.1,
  moveProb: 0.6,
  affinityPull: 0.8,
  hohRoomPull: 0.5,
  overhearConfidence: 0.4,
  overhearFraction: 0.6,
};

/**
 * NPC-personality movement weighting (residual of ledger L21/L24) — house movement bent by WHO a
 * houseguest is, so the floor plan feels personality-driven: a social butterfly roams and seeks
 * company; a low-social introvert clusters or holds a room; a volatile, rattled soul can't sit still.
 *
 * Every term is a BOUNDED nudge layered on the base 0049 assignment (stay-or-adjacent, affinity-
 * clustered, the one-room invariant) — it bends the per-NPC move rate and the affinity-seek pull,
 * never the hard floor-plan rules. The sibling-constants pattern (decisionConstants/relationship-
 * Constants): no magic number is hard-coded at a call site.
 *
 * CRITICAL (the L21/L24 root-cause + the reverted-attempt lesson): the personality rolls these
 * constants govern are drawn from a DEDICATED, isolated movement RNG stream — `presenceTick` forks
 * its own per-tick stream off the GAME seed — NEVER the orchestrator's shared per-user stream that
 * drives the off-screen society + relationship folds + votes. That isolation is the whole reason
 * this weighting can ship without perturbing the seeded `juryReach` calibration gate (the prior,
 * reverted attempt drew the extra movement rolls from the shared stream and shifted competition/
 * vote outcomes downstream). The weighting reads the static CHARACTER `stats.social` and the dynamic
 * SOUL volatility; no number ever crosses the Vault Wall (presence reads stay Vault-free).
 */
export interface MovementPersonality {
  /**
   * The center of the social-aptitude scale (`stats.social` is ~0.4–0.85, centered near here).
   * Aptitude is read as a SIGNED deviation from this center: above ⇒ more roaming/seeking, below ⇒ less.
   */
  socialCenter: number;
  /**
   * How hard social aptitude bends the per-tick MOVE probability. A high-social houseguest's base
   * `moveProb` rises (they roam); a low-social one's falls (they hold a room). The result is clamped
   * into [moveProbFloor, moveProbCeil] so it stays a probability and nobody ever fully freezes/teleports.
   */
  moveAptitudeWeight: number;
  /**
   * How hard social aptitude bends the AFFINITY PULL toward occupied rooms — high-social houseguests
   * seek company more strongly (cluster toward where their bonds are), low-social ones less so.
   */
  seekAptitudeWeight: number;
  /**
   * How much a houseguest's SOUL volatility (current emotional turbulence) adds to their move rate —
   * a rattled, churning soul can't sit still. `0.5` (a settled soul) is the no-op center.
   */
  volatilityWeight: number;
  /** The hard floor/ceiling the personality-adjusted move probability is clamped into. */
  moveProbFloor: number;
  moveProbCeil: number;
  /** The hard floor the personality-adjusted affinity pull is clamped to (never negative — no repulsion). */
  seekPullFloor: number;
}

export const MOVEMENT_PERSONALITY: MovementPersonality = {
  socialCenter: 0.55,
  moveAptitudeWeight: 0.6,
  seekAptitudeWeight: 1.2,
  volatilityWeight: 0.3,
  moveProbFloor: 0.05,
  moveProbCeil: 0.95,
  seekPullFloor: 0,
};
