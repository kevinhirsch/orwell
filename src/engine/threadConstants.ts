/**
 * Feature 0060 — the story-thread trigger/resolution scheduler: the SINGLE tunable module (sibling
 * to `decisionConstants.ts` / `relationshipConstants.ts` / `gossip.ts`'s `GOSSIP`). Every magnitude
 * the per-tick scheduler reads lives HERE — no magic number at a call site (the B59 grep gate covers
 * this file like its siblings).
 *
 * All terms are BOUNDED nudges / probabilities — they PACE the drama (when a dormant thread activates,
 * when an active one surfaces, when it resolves or expires); they never override a hard rule (0005
 * legality binds downstream, the Vault Wall is structural — 0001/§7). The scheduler authors nothing:
 * activation reuses the 0023 fold, surfacing reuses 0038 gossip + 0002 pathways, resolution reuses
 * 0023 again. These knobs only decide WHICH transition fires this tick.
 */
export const THREAD = {
  // ── per-tick transition probabilities (bounded; seeded side-rng rolls) ──────────────────────────
  /** Chance a RIPE dormant thread (its structured trigger condition met) activates this tick. */
  activateProb: 0.2,
  /** Chance an ACTIVE thread surfaces this tick (only if the season cap still allows). */
  surfaceProb: 0.15,
  /** OF a surfacing, the chance it goes to the PLAYER (vs NPC↔NPC gossip only) — surfacing to the
   *  player is rarer still (§5.2), so most thread drama is half-caught secondhand or never learned. */
  surfaceToPlayerProb: 0.3,

  // ── restraint caps (the L40 lesson — not every secret detonates) ────────────────────────────────
  /** HARD cap on threads that ever SURFACE in a season (range guidance 3–4). Once spent, no further
   *  thread surfaces to ANYONE this season — surplus ripe threads still activate + resolve, but their
   *  drama stays off-screen (the direct analogue of 0059's "≤2 ties / ≤2 showmances" sparseness). */
  maxSurfacedPerSeason: 4,
  /** No single tick detonates a CLUSTER — at most this many dormant→active flips per tick. */
  maxActivationsPerTick: 1,
  /** No single tick surfaces more than this — surfacing trickles, never bursts (mirrors the above). */
  maxSurfacesPerTick: 1,

  // ── lifecycle windows (in WEEKS) ────────────────────────────────────────────────────────────────
  /** An un-surfaced ACTIVE thread burns down (resolves off-screen) after this many weeks active. */
  resolveAfterWeeks: 3,
  /** A never-triggered DORMANT thread EXPIRES (recorded, never deleted) after this many weeks since seed. */
  expireAfterWeeks: 6,

  // ── structured-trigger thresholds ───────────────────────────────────────────────────────────────
  /** `house-tightens` fires at/below this living-cast count. */
  tightenCastSize: 8,
  /** `nominated-twice` fires once the source has been on the block in at least this many distinct weeks. */
  nominatedWeeksForRivalry: 2,
  /** `cornered-socially` fires when the source's bond read is in the bottom quantile of the living house. */
  corneredBottomQuantile: 0.25,
} as const;
