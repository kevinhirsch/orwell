/**
 * The structured PUBLIC physical-characteristics facet (feature 0058 §3/§4).
 *
 * The SINGLE source of truth shared by BOTH the portrait/image-gen prompt (L29) AND the text
 * narration (L23 — stop re-describing bodies): a structured descriptor, distinct from the prose
 * `appearance`/`presentation` blurb, so words and picture never drift. Pure DOMAIN data (no I/O):
 * lives here so the engine factory and any consumer share ONE definition with no import cycle.
 *
 * PUBLIC & Vault-free by construction — every field is a short, gender-neutral English phrase with
 * NO competition-stat-key substring ("physical"/"mental"/"social") and NO bare float, so it can never
 * serialize into the `"physical":`-style key form or the float form the Vault leak-scans hunt for.
 */
export interface PhysicalCharacteristics {
  /** Height + build, e.g. "tall and broad-shouldered". */
  heightBuild: string;
  /** Skin tone / ethnicity cue, e.g. "warm brown skin". */
  skinTone: string;
  /** Hair, e.g. "tight natural curls, jet black". */
  hair: string;
  /** Distinctive facial features, e.g. "a square jaw and deep-set eyes". */
  facialFeatures: string;
  /** A distinguishing mark (scar / tattoo / freckles / piercing), or "none notable". */
  distinguishingMark: string;
  /** An age-appropriate look cue, e.g. "youthful, early-twenties energy". */
  ageLook: string;
  /** Personal style, e.g. "streetwear and bold sneakers". */
  style: string;
}
