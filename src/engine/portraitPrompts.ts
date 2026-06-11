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

/** The public appearance facets available on the Vault-free HouseguestCard (B61). */
export interface PublicAppearanceFacets {
  /** e.g. "athletic, close-cropped hair, a warm smile" */
  appearance: string;
  /** e.g. 27 */
  age: number;
  /** e.g. "casual and laid-back" */
  presentation: string;
}

/** A generated portrait prompt ready to hand to an image provider. */
export interface PortraitPromptResult {
  houseguestId: string;
  name: string;
  prompt: string;
}

/**
 * Build a photorealistic portrait prompt for one houseguest using ONLY their
 * public appearance facets and the season-level style anchor. The output is
 * safe to send to any image provider — it carries no hidden game state.
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
  const { appearance, age, presentation } = facets;
  const prompt = [
    styleAnchor,
    `Subject: ${name}, ${age} years old`,
    `Physical appearance: ${appearance}`,
    `Presentation style: ${presentation}`,
    "Expression: natural, in the moment",
    "Framing: head-and-shoulders portrait, slightly off-center",
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
        },
        styleAnchor,
      ),
    );
}
