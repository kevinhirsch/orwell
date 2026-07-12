/**
 * Issue #1396 — the weekly Diary-Room PULL-QUOTE REEL: the SINGLE tunable module (sibling to
 * `confessionalConstants.ts` `CONFESSIONAL` / `confidenceConstants.ts` `CONFIDENCE` / `gossip.ts`'s
 * `GOSSIP` / `driveConstants.ts` `DRIVE` / `triggerConstants.ts` `TRIGGER`). Every magnitude the reel
 * curator reads lives HERE — no magic number at a call site (the B59 grep-gate convention: one tunable
 * home per constant set, never re-inlined).
 *
 * WHAT THE REEL IS. A curated montage of the season's most notable Diary-Room lines — the player's OWN
 * confessionals (player-knowledge, OOC) AND the NPCs' confessionals (Vault-held) — collected by week and
 * surfaced ONLY at the 0048 post-season retrospective (or the sanctioned `producerVault` debug unseal),
 * exactly like the eviction ballots and hidden story already do. It is a PURE, read-time SELECTION over
 * lines the game ALREADY composed and recorded: it draws NO rng, records NO event, and mutates NO state,
 * so the seeded competition/vote/jury spine is byte-identical whether or not it runs (mandate #3 / ADR
 * 0005 — proven by `pullQuoteReelNeutral.test.ts`). These knobs decide ONLY which already-said lines are
 * notable enough to make the montage, how many per week, and how many across the season — never content.
 *
 * THE WALL (mandate #2). An NPC confessional line is Vault content. This module is a pure ranker over
 * lines the CALLER hands it; the caller (`GameSessionAdapter.buildVaultUnseal`) invokes the reel ONLY
 * inside the one sanctioned post-season / admin-debug unseal seam, so a confessional quote can reach the
 * reel ONLY there — never a per-turn player or admin projection (the `pullQuoteReel.test.ts` Vault
 * sentinel is the gate). The player's own Diary-Room lines are NOT Vault (player-knowledge, no NPC
 * pathway); they are marked with a distinct `source` so the two channels stay explicit.
 */
export const PULL_QUOTE = {
  /** Max quotes surfaced per week in the reel — a montage beat per week, never a full transcript. */
  perWeekCap: 2,
  /** Max quotes across the WHOLE season reel (bounds the payload; the most notable survive globally). */
  seasonCap: 16,
  /**
   * The minimum length (after the `[confessional …]` / `[diary-room]` prefix is stripped) for a line to
   * be eligible — a montage wants a real line, not a stray fragment.
   */
  minLength: 24,
  /**
   * The notability FLOOR: the minimum "charge" (count of distinct `chargeTerms` present) a line needs to
   * be reel-eligible. `1` drops the truly inert lines (pure ambient mood) while keeping any line that
   * names a target, a bond, a vote, or a betrayal; the caps then keep only the most charged of those.
   */
  minCharge: 1,
  /**
   * The canonical eviction announcement that DELIMITS a week in the insertion-ordered event log. Each
   * eviction closes its week: the `"<name> is evicted"` house-event fires exactly once per eviction,
   * whereas the anonymized vote reveals read "a vote to evict …" and are deliberately NOT matched. Read
   * off PUBLIC (non-hidden) `house-event` beats only — never a Vault read.
   */
  evictionCue: "is evicted",
  /**
   * The NOTABLE terms whose presence marks a Diary-Room line as reel-worthy — the vocabulary of a real
   * strategic confessional (a named target, a bond, a vote, a betrayal, the stakes). A pure Vault-safe
   * text signal: it reads only the words already in a line the game composed, never a hidden number or
   * another houseguest's sealed state. Matched case-insensitively as substrings.
   */
  chargeTerms: [
    "threat", "target", "coming for", "gone", "biggest", "write", "the name",
    "blindside", "backdoor", "trust", "ride-or-die", "ride or die", "vote",
    "evict", "nominat", "veto", "betray", "war", "untouchable", "shaken",
  ] as readonly string[],
} as const;
