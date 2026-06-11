/**
 * Image generation budget constants (0051).
 *
 * Generation is the most expensive lever in the game; these constants bound it.
 * Declared here — never inlined — so tuning the budget doesn't require touching
 * logic (the same discipline as `temperatureConstants.ts` and `relationshipConstants.ts`).
 *
 * Move-in portrait generation (auto-fires at season start for every houseguest)
 * is EXEMPT from the per-turn cap — it is a bounded one-time season-start cost,
 * not a player-initiated generation.
 */
export const IMAGE_BUDGET = {
  /** Max image generations per player turn (move-in portrait set is exempt). */
  perTurnCap: 3,
  /** Max image generations per game week. */
  perWeekCap: 10,
  /** The season-start cast portrait set is outside all per-turn / per-week caps. */
  moveInPortraitExempt: true,
} as const;

/**
 * The photorealistic style anchor variants seeded at cast time. One descriptor set
 * is drawn per season; the same seed always draws the same style, so the house looks
 * like itself across restarts and throughout the season.
 *
 * These are qualitative visual anchors only — no stat, soul, or hidden content.
 */
export const STYLE_ANCHOR_VARIANTS = [
  "photorealistic, reality TV show, warm studio lighting, Big Brother house aesthetic, professional headshot",
  "photorealistic, reality TV series, cool studio lighting, Big Brother house aesthetic, professional portrait",
  "photorealistic, reality TV show, natural warm lighting, Big Brother house backdrop, professional headshot",
  "photorealistic, reality TV series, dynamic studio lighting, Big Brother house aesthetic, sharp portrait",
  "photorealistic, reality TV show, soft studio lighting, Big Brother house aesthetic, professional headshot",
] as const;
