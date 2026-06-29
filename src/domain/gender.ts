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
