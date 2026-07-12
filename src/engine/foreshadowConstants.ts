/**
 * Feature 0103 — edit-bay foreshadowing: the SINGLE tunable module (sibling to `threadConstants.ts`'s
 * `THREAD`, `secretPacingConstants.ts`'s `SECRET_PACING`, `gossip.ts`'s `GOSSIP`). Every magnitude the
 * foreshadow pass reads lives HERE — no magic number at a call site (the B59 grep gate covers this file
 * like its siblings; every field below has a REAL consumer in `foreshadow.ts`).
 *
 * The foreshadow layer emits an occasional Vault-SAFE production-edit HINT about a pathway ALREADY IN
 * MOTION in the hidden layer — surfacing ONLY a public in-room observation (a lingering camera / a clipped
 * aside), never a sealed premise or number, and NEVER committing the seeded outcome (a hint can be a
 * fake-out). All terms are BOUNDED; a hint folds nothing and advances nothing. Default-off (an
 * `ORWELL_FORESHADOW` flag, the 0092/0085 sparseness sibling) ⇒ zero foreshadow draws ⇒ the seeded
 * comp/vote/jury spine is byte-identical.
 */
export const FORESHADOW = {
  // ── foreshadowFit: how worth nodding at, for THIS player, now (∈ [0,1], engine-only, never shown) ──────
  // fit = relevanceWeight·relevance + observabilityWeight·observability + leadTimeWeight·leadTime
  //       − alreadyHintedPenalty·alreadyHinted   (then clamped to [0,1])
  /** Weight on player↔involved-parties proximity + tension (both-way 0026 edges) — the show edits toward
   *  the people the player is close to or wary of, so the eventual payoff reads as "I knew it", not "who?". */
  relevanceWeight: 0.4,
  /** Weight on OBSERVABILITY — is there a PUBLIC thing to hang the hint on (0049 co-presence / 0077
   *  conspicuousness)? The edit shows footage; a hint needs a real in-room observation to point at. */
  observabilityWeight: 0.4,
  /** Weight on LEAD-TIME — a pathway 1-2 weeks from its likely payoff edits best (not just-fired, not
   *  stale), so the foreshadow and its payoff are correlated in time (the whole point of a plant). */
  leadTimeWeight: 0.3,
  /** Penalty for a pathway already foreshadowed (its `lastHintedWeek` set) — the edit moves on, it never
   *  nags the same setup. Large enough to push an already-hinted pathway well below a fresh one. */
  alreadyHintedPenalty: 0.6,

  // ── eligibility floors ────────────────────────────────────────────────────────────────────────────────
  /** A pathway with LESS public surface than this is NOT foreshadowable — there is nothing in the room to
   *  edit (a purely off-screen scheme is never hinted; the show never invents an observation). */
  observabilityFloor: 0.2,
  /** Below this fit the pathway is not worth nodding at for this player now — it keeps churning off-screen. */
  fitFloor: 0.35,

  // ── the cadence — a nod now and then, never every week (the heart of the feature) ─────────────────────
  /** The weekly target band FLOOR — most weeks aim for zero-or-one nod (a quiet week is a feature). */
  weeklyTargetMin: 0,
  /** The weekly target band CEILING. */
  weeklyTargetMax: 1,
  /** A HARD weekly ceiling: at most this many hints surface in one week, however many pathways are ripe
   *  (the L40 firehose lesson, applied as a CADENCE). */
  maxHintsPerWeek: 1,
  /** A HARD season cap (the 0060/0092 sparseness sibling) — the true ceiling on total nods across a season. */
  maxHintsPerSeason: 5,
  /** OF the top-fit candidate, the seeded per-tick chance the nod actually fires (variable-ratio — the
   *  player can't predict the cadence, only that the show DOES nod). Modest so most weeks get zero-or-one. */
  hintEligibilityRate: 0.3,

  // ── the production voice ──────────────────────────────────────────────────────────────────────────────
  /** The "something's building" tone the narrator weaves in — SUGGESTIVE, never declarative (the show
   *  nods, it never states). The model voices it richly; this is only the Vault-safe seed word. */
  toneWord: "building",
} as const;
