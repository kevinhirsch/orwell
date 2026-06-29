/**
 * Vault-free portrait prompt builder (0051).
 *
 * Takes ONLY a houseguest's PUBLIC appearance facets (the same fields the visible
 * projection already exports on `HouseguestCard`: appearance, age, presentation)
 * and the per-season style anchor. NO hidden stats, NO soul content, NO relationship
 * values, NO engine-only store imports — structurally enforced by dependency-cruiser.
 *
 * The E11/E15 discipline applies: a sentinel sweep over assembled prompts must find
 * no hidden-layer content. This module is the gate; the tests are the proof.
 */

import type { PhysicalCharacteristics } from "../domain/physicalCharacteristics";
import { genderPresentationPhrase } from "../domain/gender";

export { genderPresentationPhrase };

/** The public appearance facets available on the Vault-free HouseguestCard (B61). */
export interface PublicAppearanceFacets {
  /** e.g. "athletic, close-cropped hair, a warm smile" */
  appearance: string;
  /** e.g. 27 */
  age: number;
  /** e.g. "casual and laid-back" */
  presentation: string;
  /**
   * L29/L23/0058: the STRUCTURED physical facet — the SINGLE source of truth shared by the portrait
   * prompt AND the text narration, so the face always matches the person (height/build, skin tone,
   * hair, facial features, distinguishing mark, age-look, style). When present it AUTHORS the physical
   * description (richer + more differentiating than the prose `appearance`); when absent we fall back
   * to the prose line. All facets are PUBLIC (already on the card) — no hidden content ever rides here.
   */
  physicalCharacteristics?: PhysicalCharacteristics;
  /**
   * Feature 0063 — the PUBLIC diversity + personality facets that make each shot uniquely THIS person.
   * ALL are PUBLIC (already on the HouseguestCard): the heritage / cultural identity (`ethnicity` —
   * grounds an authentic, accurate likeness so the face matches who the character is), how they present
   * (`genderPresentation`), and their observable DEMEANOR (`demeanor` — expression / vibe / energy, the
   * L28 register). A PRIVATELY-held orientation is NOT in this type and MUST NEVER enter a prompt — only
   * public facets feed the shot (the §5 Vault rule). Identity informs a dignified, authentic likeness —
   * never a caricature: the appearance is built from the grounded physical facet + heritage + demeanor,
   * not from clichés.
   */
  ethnicity?: string;
  genderPresentation?: "man" | "woman" | "nonbinary";
  demeanor?: string;
}

import { EXPRESSION_VARIANTS, FRAMING_VARIANTS, BACKDROP_VARIANTS } from "./imageConstants";

/**
 * Compose the structured physical facet into a single rich appearance clause (L29). Skips a
 * "none notable" distinguishing mark so it never reads as a literal instruction to the image model.
 * Pure string assembly over PUBLIC fields — no hidden content.
 */
export function physicalFacetToAppearance(p: PhysicalCharacteristics): string {
  const parts = [p.heightBuild, p.skinTone, p.hair, p.facialFeatures];
  if (p.distinguishingMark && !/^none\b/i.test(p.distinguishingMark.trim())) parts.push(p.distinguishingMark);
  parts.push(p.ageLook);
  return parts.join(", ");
}

/** A generated portrait prompt ready to hand to an image provider. */
export interface PortraitPromptResult {
  houseguestId: string;
  name: string;
  prompt: string;
}

/**
 * FNV-1a 32-bit over a string — the stable per-subject shot key (G24). Pure and
 * dependency-free: the same (houseguestId, season anchor) pair always yields the
 * same hash, so a houseguest re-renders as the same shot across restarts and
 * backfills, while different houseguests land on different picks.
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build a photorealistic portrait prompt for one houseguest using ONLY their
 * public appearance facets and the season-level style anchor. The output is
 * safe to send to any image provider — it carries no hidden game state.
 *
 * G24: expression, framing, and backdrop vary PER SUBJECT (hash-seeded off the
 * houseguest id + the season anchor) instead of every portrait sharing one
 * identical pose/crop — the cast stops looking like a grid of siblings while
 * the season anchor keeps the set cohesive.
 *
 * The name is included in the prompt purely for identification of the subject
 * in the output; it is a public fact (the player knows every houseguest's name).
 */
export function buildPortraitPrompt(
  houseguestId: string,
  name: string,
  facets: PublicAppearanceFacets,
  styleAnchor: string,
): PortraitPromptResult {
  const { appearance, age, presentation, physicalCharacteristics, ethnicity, genderPresentation, demeanor } = facets;
  const shot = fnv1a(`${houseguestId}|${styleAnchor}`);
  const expression = EXPRESSION_VARIANTS[shot % EXPRESSION_VARIANTS.length]!;
  const framing = FRAMING_VARIANTS[(shot >>> 8) % FRAMING_VARIANTS.length]!;
  const backdrop = BACKDROP_VARIANTS[(shot >>> 16) % BACKDROP_VARIANTS.length]!;
  // L29: prefer the STRUCTURED facet (distinct faces, one source of truth with the narration); fall
  // back to the prose `appearance` for pre-0058 saves that never seeded a facet.
  // #1140 NOTE (deferred follow-up): the stored physicalCharacteristics (build/hair/etc.) are gender-
  // AGNOSTIC pools today, so a re-picked / flipped facet keeps whatever build+hair were dealt. The directive
  // gender phrase below is the load-bearing cue; gender-AWARE build/hair pools (so the described body+hair
  // also lean with the presentation) are a larger, deliberately-deferred change — do NOT mutate the stored
  // facets here (they are byte-stable, 0007/0031).
  const physical = physicalCharacteristics ? physicalFacetToAppearance(physicalCharacteristics) : appearance;
  const styleLine = physicalCharacteristics?.style
    ? `${presentation}, ${physicalCharacteristics.style}`
    : presentation;
  // 0063 + #1140 Fix B: build a SUBJECT line that reflects the unique person — how they present + their
  // heritage (an authentic, accurate likeness, never a caricature) + age. The skin tone in `physical` is
  // already grounded in this same heritage, so the description is internally consistent and dignified.
  //
  // De-bias the NAME: lead with the GENDER phrase (the directive cue), not the bare proper noun. A NAME can
  // read gendered to an image model (a unisex/flipped/AI-overridden name like "Marlon" on a woman), and if
  // it's the FIRST/strongest token the model renders the NAME's gender, contradicting the stored facet. So
  // the gender phrase comes FIRST, the name trails as a plain identification tag, and the directive phrase
  // is REPEATED right after the name so the cue still flanks it. The engine carries `genderPresentation` for
  // the whole cast, so the lead phrase is effectively always present (the `if` only guards a legacy absence).
  const genderPhrase = genderPresentation ? genderPresentationPhrase(genderPresentation) : undefined;
  const subjectParts: string[] = [];
  if (genderPhrase) subjectParts.push(genderPhrase);
  subjectParts.push(`${age} years old`);
  if (ethnicity) subjectParts.push(`of ${ethnicity} heritage`);
  // The name LAST, as an identifier — and re-state the gender cue alongside it so the proper noun never
  // stands as the lone, dominant gender signal in the prompt.
  subjectParts.push(genderPhrase ? `named ${name} (${genderPhrase})` : `named ${name}`);
  // 0063: the observable DEMEANOR colors the EXPRESSION line — the face matches the personality (a blunt
  // person reads guarded, a warm one reads open) instead of every portrait sharing one default affect.
  const expressionLine = demeanor ? `${expression}, ${demeanor}` : expression;
  const prompt = [
    styleAnchor,
    `Subject: ${subjectParts.join(", ")}`,
    `Physical appearance: ${physical}`,
    `Presentation style: ${styleLine}`,
    `Expression: ${expressionLine}`,
    `Framing: ${framing}`,
    `Setting: ${backdrop}`,
  ].join(". ");

  return { houseguestId, name, prompt };
}

/**
 * Build portrait prompts for a full cast from the public visible projection.
 * Called by `GameSessionAdapter.createCharacter` after the house is generated.
 *
 * `houseguests` is the Vault-free `house` array from `GameStateView` — only
 * public fields; hidden elements, stats, and soul never reach this function.
 */
export function buildCastPortraitPrompts(
  houseguests: ReadonlyArray<{
    id: string;
    name: string;
    appearance?: string;
    age?: number;
    presentation?: string;
    physicalCharacteristics?: PhysicalCharacteristics;
    ethnicity?: string;
    genderPresentation?: "man" | "woman" | "nonbinary";
    demeanor?: string;
  }>,
  styleAnchor: string,
): PortraitPromptResult[] {
  return houseguests
    .filter((hg) => hg.appearance && hg.age !== undefined && hg.presentation)
    .map((hg) =>
      buildPortraitPrompt(
        hg.id,
        hg.name,
        {
          appearance: hg.appearance!,
          age: hg.age!,
          presentation: hg.presentation!,
          ...(hg.physicalCharacteristics !== undefined ? { physicalCharacteristics: hg.physicalCharacteristics } : {}),
          ...(hg.ethnicity !== undefined ? { ethnicity: hg.ethnicity } : {}),
          ...(hg.genderPresentation !== undefined ? { genderPresentation: hg.genderPresentation } : {}),
          ...(hg.demeanor !== undefined ? { demeanor: hg.demeanor } : {}),
        },
        styleAnchor,
      ),
    );
}
