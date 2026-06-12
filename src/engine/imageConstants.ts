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
 * G24: anchored to CANDID PRODUCTION-STILL language with explicit imperfection cues
 * (unretouched skin, flyaway hairs, slight asymmetry) — "professional headshot,
 * studio lighting" is the most AI-saturated genre there is, and asking for it
 * produced the airbrushed sameness these cues counter.
 *
 * These are qualitative visual anchors only — no stat, soul, or hidden content.
 */
export const STYLE_ANCHOR_VARIANTS = [
  "photorealistic candid production still from a reality TV show, on-camera flash, unretouched natural skin texture, flyaway hairs, slight facial asymmetry, Big Brother house interior",
  "photorealistic documentary-style frame from a reality TV series, available window light, true-to-life skin with visible pores, unstyled details, Big Brother house backdrop",
  "photorealistic reality TV casting-tape still, slightly imperfect framing, natural unretouched complexion, stray hairs, soft indoor light, Big Brother house interior",
  "photorealistic candid moment captured on a reality TV set, mixed practical lighting, lived-in skin texture, natural blemishes, faint edge motion blur, Big Brother house behind",
  "photorealistic behind-the-scenes still from a reality TV show, handheld camera feel, honest unretouched features, uneven indoor lighting, Big Brother house interior",
] as const;

/**
 * Per-houseguest shot variation pools (G24). One pick per pool per subject, chosen by a
 * stable hash of (houseguestId + the season anchor) — the same houseguest always re-renders
 * as the same shot within a season, while the cast stops sharing one identical pose/crop.
 * Qualitative visual content only — same discipline as the anchors above.
 */
export const EXPRESSION_VARIANTS = [
  "caught mid-laugh",
  "a wry half-smile",
  "one eyebrow raised, sizing the room up",
  "caught mid-sentence",
  "relaxed, eyes drifting off-camera",
  "a competitive grin",
  "thoughtful, jaw set",
  "an easy open smile",
  "a skeptical sideways glance",
  "tired but amused",
] as const;

export const FRAMING_VARIANTS = [
  "head-and-shoulders, slightly off-center",
  "chest-up, angled three-quarter view",
  "close head-and-shoulders, looking just past the lens",
  "head-and-shoulders from a slight low angle",
  "chest-up, leaning into the frame",
  "head-and-shoulders, face turned half to camera",
  "chest-up from a slight high angle",
  "tight head-and-shoulders, centered but tilted",
] as const;

export const BACKDROP_VARIANTS = [
  "kitchen counters blurred behind",
  "the living-room couches soft in the background",
  "backyard decking out of focus behind",
  "the memory wall glowing softly behind",
  "bedroom clutter blurred in the background",
  "the dining table out of focus behind",
  "the gym corner blurred behind",
  "the hammock corner soft in the background",
] as const;
