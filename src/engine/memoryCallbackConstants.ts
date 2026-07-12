/**
 * Feature #1394 — narrator memory callbacks. The single tunable source for the Vault-free recall
 * of WITNESSED past moments that the front-end weaves into the moment framing as "facts you may
 * reference" (so a houseguest can say "you told me on day 3 you'd never write my name down").
 *
 * ADR 0003 realized as context assembly: "long-term memory is the store recalled, never the chat
 * remembered." The recall reads ONLY the player's Vault-free visible projection — never the Vault,
 * never the raw event store (see `memoryCallback.ts` + the registry wiring, and the leak test).
 *
 * Kept small + grep-able so K / threshold / caps are test-pinned in ONE place (mirrors
 * `STORY_FACT_EVENTS` / `SURFACED_FACTS_WINDOW` in `GameSessionAdapter`).
 */
export const MEMORY_CALLBACK = {
  /** How many recalled moments ride the framing AT MOST (issue #1394: 1–2). */
  k: 2,
  /**
   * Cosine relevance floor. Below this a candidate is not a genuine "callback", just the closest
   * of an unrelated set — so a scene with no relevant history emits NOTHING (the enrichment policy:
   * recall absence is not a failure). Bag-of-words / fastembed cosine over these non-negative
   * vectors lands in [0, 1], so a modest floor cleanly separates a topical hit from noise.
   */
  minScore: 0.12,
  /** Per-moment character clip (a rough token budget; the block stays tight — ADR 0003 §1). */
  maxCharsPerMoment: 240,
  /** Total character cap across ALL recalled moments — the token-budget cap the DoD requires. */
  maxCharsTotal: 420,
  /**
   * Bound the candidate pool embedded per scene (most-recent-first) so per-turn work is O(cap),
   * never O(season) — the same bounding discipline `STORY_FACT_EVENTS` uses for the re-entry recap.
   */
  poolCap: 24,
} as const;

/**
 * The default-OFF runtime flag. Read at the FE framing seam (`apply_game_framing`): absent ⇒ the FE
 * never calls the recall tool and the framing is byte-identical (the floor contract). Named here in
 * the engine purely so the flag name lives beside the tunables it governs; the engine tool itself is
 * always safe to call (it is a pure Vault-free read) — the gate is deliberately FE-side, where the
 * framing digest is assembled and where "flag off ⇒ identical framing" is provable.
 */
export const MEMORY_CALLBACKS_ENV = "ORWELL_MEMORY_CALLBACKS";
