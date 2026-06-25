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
  /**
   * Chance an NPC who is CURRENTLY IN THE PLAYER'S ROOM moves on a tick (feature 0076). Far lower
   * than `moveProb`: present company is mid-scene with the player, so they STAY by default — the
   * old `moveProb` (tuned for a tick = a chunk of house-time) churned ~60% of the room out from under
   * a live conversation every turn (the pop-in/pop-out immersion bug). They keep full agency to leave
   * — when this low roll fires they DO get up and go, and the affinity-weighted destination reads as a
   * motivated exit (toward a stronger bond) — but the scene no longer reshuffles every message.
   *
   * CRITICAL (calibration): this lever is applied ONLY to the personality-WEIGHTED, player-facing pass
   * (the dedicated movement stream, isolated from calibration). It must NEVER touch the un-weighted BASE
   * assignment the off-screen society pairs on — that still draws `moveProb` from the SHARED stream with
   * a byte-identical draw count, or the seeded juryReach spine re-phases (the L21/L24 lesson). So this is
   * NOT a retune of `moveProb` (which is load-bearing for the base); it is a separate, weighted-only floor.
   */
  companionMoveProb: number;
  /** Weight of affinity toward already-placed occupants when choosing a room. */
  affinityPull: number;
  /** How strongly the HOH gravitates to the HOH room. */
  hohRoomPull: number;
  /** Confidence carried by an overheard fact (a witness's is full/unset; this is partial). */
  overhearConfidence: number;
  /** Fraction of a scene's content an overhearer catches (NEVER 1 — through a wall, not a transcript). */
  overhearFraction: number;
  /**
   * Closed-door MUFFLE (0077 Phase 2): the multiplier on the per-scene overhear gate when the scene
   * happens behind a PRIVATE (closed) door — harder to hear into than an open-core room. Strictly
   * OPT-IN: only the player channel passes it (its own isolated `commands:` rng stream); the
   * off-screen society/orchestrator spine passes nothing, so the calibration draws are byte-identical.
   */
  doorMuffle: number;
}

export const PRESENCE: PresenceConstants = {
  overhearProb: 0.1,
  moveProb: 0.6,
  companionMoveProb: 0.12,
  affinityPull: 0.8,
  hohRoomPull: 0.5,
  overhearConfidence: 0.4,
  overhearFraction: 0.6,
  doorMuffle: 0.4,
};

/**
 * The PRIVACY / tracked-occupancy tunables (0077 Phase 2 — "who is behind a closed door" as
 * KNOWLEDGE, not a free ambient read). Pure read-side numbers — they never touch any rng stream, so
 * they cannot perturb calibration. All are God-Mode-knobbable later (the 0026/0028 constants pattern).
 */
export interface PrivacyConstants {
  /**
   * STALE-belief horizon (open question #2): how many presence ticks a tracked sighting stays on the
   * board before it decays out entirely. A belief older than this is dropped (you've lost the thread).
   * A still-fresh belief whose subject has since moved is reported as STALE, not dropped — the player
   * believes it until a new pathway corrects it.
   */
  trackedHorizonTicks: number;
  /**
   * STALE flag age: ticks before a still-live belief reads as `stale` ("you saw them go in a while
   * ago"). Derived from AGE alone — NEVER from the secret live position (that would leak that they
   * left). Below the horizon, so a belief flags stale before it finally decays out.
   */
  staleAfterTicks: number;
  /**
   * CONSPICUOUSNESS threshold (open question #3): a private room held by EXACTLY this many tracked
   * high-tenure houseguests trips the "holed up together" read. Exactly two, per the owner's framing
   * ("two alone too long implies gameplay").
   */
  conspicuousPairSize: number;
  /** Minimum ticks a sighting must have aged before it reads as conspicuous (both subjects "a while" in). */
  conspicuousMinTenureTicks: number;
  /** Confidence carried by a tracked sighting (a watched movement — solid, but not a witnessed scene). */
  trackedConfidence: number;
}

export const PRIVACY: PrivacyConstants = {
  trackedHorizonTicks: 6,
  staleAfterTicks: 3,
  conspicuousPairSize: 2,
  conspicuousMinTenureTicks: 2,
  trackedConfidence: 0.7,
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
 * CRITICAL (the L21/L24 root-cause + the two-reverted-attempts lesson). The personality-WEIGHTED,
 * player-facing positions are drawn from a DEDICATED movement RNG stream — `presenceTick` forks its own
 * per-tick stream off the GAME seed — so these constants NEVER touch the orchestrator's shared per-user
 * stream that drives the off-screen society + relationship folds + votes. But the CALIBRATION-NEUTRAL
 * BASE assignment the society pairs on still draws from that SHARED stream, un-weighted, with the SAME
 * draw count as the pre-feature build — so the seeded `juryReach` calibration spine is byte-identical.
 * Both prior attempts broke that spine by changing the shared-stream consumption: the first ADDED
 * weighting rolls to it; the second stopped drawing from it ENTIRELY (the un-weighted assignment used
 * to BE part of the spine). The fix keeps the base on the shared stream and the weighting on its own.
 * (Guards: `tests/property/movementStreamIsolation` + the shared-draw-count test in
 * `tests/unit/presence.test.ts` + the permanent `tests/property/juryReach` gate.) The weighting reads
 * the static CHARACTER `stats.social` and the dynamic SOUL volatility; no number ever crosses the Vault
 * Wall (presence reads stay Vault-free).
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
