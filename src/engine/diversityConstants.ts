/**
 * Feature 0063 — casting diversity floor: the single tunable constants module (the sibling of
 * `decisionConstants.ts` / `relationshipConstants.ts` / `temperatureConstants.ts`). Every threshold
 * and pool that the diversity floor reasons over lives HERE — no magnitude is hard-coded at a call
 * site (the existing grep gate covers it).
 *
 * The owner's LOCKED decisions (2026-06-19), baked in:
 *  1. Floors over the 15 NPCs: BIPOC ≥ 8, LGBTQ+ ≥ 2, gender roughly balanced, ages spread across
 *     bands (on the L18c age ≥ 21 floor). Validated/repaired like L28's CAPS.
 *  2. Ethnicity is a FIRST-CLASS identity attribute (heritage / cultural identity — an authentic facet
 *     of a full character, never a stereotype kit). It grounds 0058's `physicalCharacteristics.skinTone`
 *     so the text and the portrait agree.
 *  3. Orientation is seeded per houseguest; disclosure is character-driven — some publicly out (a public
 *     facet), some PRIVATE (Vault-sealed, surfacing only via a 0002 pathway). Eligibility-only gating of
 *     0059 showmances.
 *  4. Gender is balanced + inclusive — roughly balanced men/women, with nonbinary possible and counted
 *     toward the LGBTQ+ floor.
 *
 * THE DIGNITY DISCIPLINE (§2/§6): identity is the DEPTH of a full character, never a reductive single
 * word. Every pool entry below is an authentic, plain-English facet of a real person — heritage as
 * lived background, not a caricature kit. No surface ever reduces a houseguest to their ethnicity or
 * orientation; these are ONE true facet woven into a §3-deep profile (0058).
 *
 * NO-LEAK DISCIPLINE (CRITICAL, mirrors L28/0058): every PUBLIC facet string is plain English with NO
 * competition-stat-key substring ("physical"/"mental"/"social") and NO bare float, so it can never
 * serialize into the `"physical":`-style key form or the float form the Vault leak-scans hunt for.
 * These attributes are DESCRIPTIVE ONLY — they never feed a competition, a vote, or any outcome.
 */

// ── §3 — the four engine-guaranteed floors (over the 15 NPCs) ──────────────────────────────────────

/** BIPOC representation floor: at least this many houseguests of color across the 15-cast (owner: ≥ 8). */
export const MIN_BIPOC = 8;

/** LGBTQ+ representation floor: at least this many houseguests with a non-straight orientation (owner: ≥ 2). */
export const MIN_QUEER = 2;

/**
 * Gender-balance floor: neither men nor women may fall below this many of the 15-cast (owner: "roughly
 * balanced"). With 6/6 as the per-binary minimum, the remaining 3 slots are free — including for any
 * nonbinary houseguests — so a 6-men/6-women/3-other split satisfies it, as does a 7/8 or 8/7 split.
 */
export const MIN_PER_BINARY_GENDER = 6;

/**
 * Age-spread floor: each defined age band must carry at least this many houseguests, so the cast SPANS
 * generations instead of clustering in the 20s. The bands sit on top of the L18c `age ≥ 21` floor.
 */
export const MIN_PER_AGE_BAND = 2;

/**
 * The L28-style CAP on the age bands — no single band may exceed this share of the cast, so the cast
 * never collapses back into one generation even though the underlying age draw skews young. Sized to
 * coexist with the spread floor (3 bands × ≥2 floor, with the 20s allowed to hold the bulk up to this).
 */
export const MAX_PER_AGE_BAND = 11;

/**
 * The age bands (inclusive lower bound; the next band's lower bound is the exclusive upper). Sized so a
 * 15-cast with ≥2 per band still skews young-and-realistic: a genuine handful in the 30s and 40s+ rather
 * than one generation of near-twins. The eligibility floor (L18c) is the lower edge of the first band.
 */
export const AGE_ELIGIBILITY_FLOOR = 21;
export const AGE_BANDS: ReadonlyArray<{ id: string; min: number; maxExclusive: number }> = [
  { id: "20s", min: 21, maxExclusive: 30 },
  { id: "30s", min: 30, maxExclusive: 40 },
  { id: "40plus", min: 40, maxExclusive: 999 },
];

/** The age band id an age falls into (for the spread floor + the repair). */
export function ageBandOf(age: number): string {
  for (const b of AGE_BANDS) if (age >= b.min && age < b.maxExclusive) return b.id;
  return AGE_BANDS[0]!.id; // below the floor is repaired up; never lands here in practice
}

// ── §3.2 — ethnicity: a FIRST-CLASS identity attribute (heritage / cultural identity) ──────────────
// An authentic, dignified heritage facet — lived background, NOT a stereotype kit. `bipoc` marks which
// count toward the BIPOC floor; `skinTone` GROUNDS 0058's `physicalCharacteristics.skinTone` so the text
// and the portrait agree (owner decision #2). The labels read as real people's backgrounds; the skin-tone
// cue is a plain, gender-neutral complexion phrase (the same vocabulary 0058 already uses). The pool is
// deliberately broad so the cast reads as a genuine, country-reflecting crew — never a checklist of types.
export interface EthnicityIdentity {
  /** The heritage/cultural-identity label — a lived facet of a full character (e.g. "Black American"). */
  heritage: string;
  /** Whether this heritage counts toward the BIPOC representation floor. */
  bipoc: boolean;
  /** The grounded complexion cue feeding 0058's physicalCharacteristics.skinTone (plain English). */
  skinTone: string;
}

/** BIPOC heritages — drawn first so the floor is comfortably satisfiable (≥8 of 15). Authentic, not reductive. */
export const BIPOC_ETHNICITIES: readonly EthnicityIdentity[] = [
  { heritage: "Black American", bipoc: true, skinTone: "deep brown skin" },
  { heritage: "Nigerian American", bipoc: true, skinTone: "rich dark complexion" },
  { heritage: "Caribbean American", bipoc: true, skinTone: "warm brown skin" },
  { heritage: "Mexican American", bipoc: true, skinTone: "warm tan complexion" },
  { heritage: "Puerto Rican", bipoc: true, skinTone: "golden-brown skin" },
  { heritage: "Dominican American", bipoc: true, skinTone: "medium brown skin" },
  { heritage: "Chinese American", bipoc: true, skinTone: "light tan complexion" },
  { heritage: "Filipino American", bipoc: true, skinTone: "warm tan complexion" },
  { heritage: "Korean American", bipoc: true, skinTone: "fair warm complexion" },
  { heritage: "South Asian American", bipoc: true, skinTone: "deep amber-toned skin" },
  { heritage: "Vietnamese American", bipoc: true, skinTone: "light golden complexion" },
  { heritage: "Native American", bipoc: true, skinTone: "warm reddish-brown skin" },
  { heritage: "Middle Eastern American", bipoc: true, skinTone: "olive complexion" },
  { heritage: "multiracial", bipoc: true, skinTone: "warm medium-brown skin" },
];

/** Non-BIPOC heritages — fill the remaining slots so the cast still reflects the whole country. */
export const NON_BIPOC_ETHNICITIES: readonly EthnicityIdentity[] = [
  { heritage: "Irish American", bipoc: false, skinTone: "fair freckled skin" },
  { heritage: "Italian American", bipoc: false, skinTone: "light olive complexion" },
  { heritage: "Polish American", bipoc: false, skinTone: "pale rosy complexion" },
  { heritage: "German American", bipoc: false, skinTone: "fair skin" },
  { heritage: "Greek American", bipoc: false, skinTone: "olive complexion" },
  { heritage: "Scandinavian American", bipoc: false, skinTone: "pale fair skin" },
];

export const ALL_ETHNICITIES: readonly EthnicityIdentity[] = [...BIPOC_ETHNICITIES, ...NON_BIPOC_ETHNICITIES];

/** No single heritage may pile up beyond this across the 15-cast (a SPREAD cap, the L28 sibling). */
export const MAX_PER_ETHNICITY = 2;

// ── §3.3 — gender presentation (balanced + inclusive) ──────────────────────────────────────────────
// A descriptive PUBLIC facet (how the houseguest presents), never a competition input. Nonbinary is a
// first-class value and counts toward the LGBTQ+ floor (owner decision #4). The labels are plain words.
export type GenderPresentation = "man" | "woman" | "nonbinary";
export const GENDER_PRESENTATIONS: readonly GenderPresentation[] = ["man", "woman", "nonbinary"];

/** Nonbinary is sparse + realistic — at most this many across the 15-cast (still counts toward MIN_QUEER). */
export const MAX_NONBINARY = 2;

// ── §4 — the orientation model (organic, character-driven, Vault-walled) ───────────────────────────
// Every houseguest has a seeded orientation. `queer` marks which count toward the LGBTQ+ floor. Plain
// English, descriptive only — NEVER a stat, never a competition input, never telegraphed by a banner.
export type Orientation = "straight" | "gay" | "lesbian" | "bisexual" | "queer" | "pansexual";
export interface OrientationSpec {
  orientation: Orientation;
  /** Whether this orientation counts toward the LGBTQ+ representation floor. */
  queer: boolean;
}
export const ORIENTATIONS: readonly OrientationSpec[] = [
  { orientation: "straight", queer: false },
  { orientation: "gay", queer: true },
  { orientation: "lesbian", queer: true },
  { orientation: "bisexual", queer: true },
  { orientation: "queer", queer: true },
  { orientation: "pansexual", queer: true },
];

/** The queer (non-straight) orientations the floor draws from when it must repair UP to MIN_QUEER. */
export const QUEER_ORIENTATIONS: readonly OrientationSpec[] = ORIENTATIONS.filter((o) => o.queer);

/**
 * DISCLOSURE is character-driven (§4): of the queer houseguests, roughly this fraction are PUBLICLY OUT
 * (a public facet the house knows); the rest hold it PRIVATELY (a Vault-sealed attribute reaching the
 * player only via a 0002 pathway). A seeded per-houseguest roll against this probability decides, so it
 * is NOT a uniform rule — some out, some private, exactly as real people differ. Tuned so a season
 * reliably carries BOTH an out houseguest and (often) a private one, satisfying the §4/§5 scenarios.
 */
export const PUBLICLY_OUT_PROB = 0.6;

/**
 * SATISFIABILITY MARGIN (documented, the L28 precedent's "12 builds / ≤2 each covers 15" note):
 *  • BIPOC: 14 BIPOC heritages × ≤2 each = 28 ≫ MIN_BIPOC(8) and ≫ 15 — comfortably satisfiable, and
 *    the floor (8) leaves 7 non-BIPOC slots, also comfortably filled (6 heritages × ≤2 = 12 ≥ 7).
 *  • Gender: MIN_PER_BINARY_GENDER(6)+6 = 12 ≤ 15, leaving 3 free (incl. ≤MAX_NONBINARY nonbinary).
 *  • Age: 3 bands × MIN_PER_AGE_BAND(2) = 6 ≤ 15 — the remaining 9 skew young as before.
 *  • LGBTQ+: MIN_QUEER(2) ≤ 15 trivially; 5 queer orientations give variety.
 * The floors and L28's caps are JOINTLY satisfiable on a 15-cast with margin to spare.
 */
export const SATISFIABILITY_NOTE = "floors+caps jointly satisfiable on a 15-cast with margin (see SATISFIABILITY_MARGIN)";
