/**
 * Gender presentation → phrase / pronoun mapping (issue #1140).
 *
 * The SINGLE shared home for turning the PUBLIC `genderPresentation` facet ("man" | "woman" |
 * "nonbinary") into (a) a dignified subject phrase and (b) a pronoun set. Both the PORTRAIT prompt
 * (`portraitPrompts.ts`) and the TEXT narration (`momentPrompts.ts`) read these helpers, so the
 * narrated voice anchors the SAME stored facet the face was drawn from — they can never diverge, and
 * the narrator stops inferring gender/pronouns from the NAME (which the engine deliberately allows
 * `genderPresentation` to disagree with: `src/engine/diversity.ts`).
 *
 * PUBLIC + Vault-free by construction: `genderPresentation` is a public facet already on the roster
 * card. This module is pure string assembly over that one facet — no I/O, no rng, no hidden state. It
 * deliberately lives in the dependency-free `domain` layer so neither the narration nor the portrait
 * builder has to import the other (one source of truth, no cross-module coupling).
 *
 * NOTE: gender PRESENTATION is NOT orientation. A privately-held orientation is Vault-sealed
 * (`diversity.ts` `privateOrientationToVaultContent`) and MUST NEVER ride here.
 */

/**
 * How a subject presents — a dignified, DIRECTIVE phrase. Authentic, never a caricature (feature 0063).
 *
 * #1140 Fix B: the phrase is the strongest gender cue the IMAGE model gets, so it states BOTH the noun
 * ("a man"/"a woman") AND the presentation ("masculine"/"feminine presentation") — the redundant, explicit
 * cue keeps the render on the STORED facet even when the proper-noun NAME in the prompt leans the other way
 * (a unisex/flipped/AI-overridden name). The narration reads the same phrase, so prose + portrait stay
 * anchored to the one facet. (Wording only — descriptive, calibration-neutral.)
 */
export function genderPresentationPhrase(g: "man" | "woman" | "nonbinary"): string {
  return g === "man" ? "a man (masculine presentation)"
    : g === "woman" ? "a woman (feminine presentation)"
    : "a person of androgynous, nonbinary presentation";
}

/**
 * The pronoun set the narrator must use for a houseguest, derived deterministically from the stored
 * PUBLIC `genderPresentation` facet — so the prose voices the same identity the portrait encodes.
 */
export function pronounsFor(g: "man" | "woman" | "nonbinary"): string {
  return g === "man" ? "he/him" : g === "woman" ? "she/her" : "they/them";
}

/** Type guard for the one gender-presentation enum shared by every facet (issue #1326). */
export function isGenderPresentation(v: unknown): v is "man" | "woman" | "nonbinary" {
  return v === "man" || v === "woman" || v === "nonbinary";
}

/**
 * The explicit fallback voiced when NO `genderPresentation` facet is on file (issue #1326). An
 * ACTIVE houseguest is dealt this facet by the diversity floor at cast time, so it should never be
 * unset in a live game — but a legacy save predating feature 0063, or any non-standard creation path
 * that skips the diversity floor, can still leave it `undefined`. Before this fix the roster/premiere
 * builders in `momentPrompts.ts` gated the pronoun clause on `h.genderPresentation && …`, so an unset
 * facet made the WHOLE clause fall out of a `filter(Boolean)` array — a SILENT omission that let the
 * narrator fall back to guessing gender from the houseguest's NAME, the exact failure this module
 * exists to prevent. This constant is the explicit, never-silent substitute for that dropped clause.
 */
export const UNCONFIRMED_GENDER_CLAUSE = "pronouns unconfirmed — use they/them, never infer from the name";

/**
 * The pronoun-guidance clause for a roster/premiere line: the real phrase + pronoun set when the
 * facet is on file, or the explicit `UNCONFIRMED_GENDER_CLAUSE` fallback when it is not — NEVER an
 * empty/falsy value a `filter(Boolean)` builder could silently drop (issue #1326). Pure (no I/O); a
 * caller that wants to also SURFACE the unset case (e.g. a console warning) checks `g === undefined`
 * itself before calling this.
 */
export function genderGuidanceClause(g: "man" | "woman" | "nonbinary" | undefined): string {
  return g ? `${genderPresentationPhrase(g)} (use ${pronounsFor(g)})` : `(${UNCONFIRMED_GENDER_CLAUSE})`;
}
