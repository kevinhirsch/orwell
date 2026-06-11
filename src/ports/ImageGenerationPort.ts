/**
 * Provider-agnostic image generation port (0051).
 *
 * The engine side NEVER calls this directly — it assembles Vault-free prompts
 * via `portraitPrompts.ts` and returns them in the `createCharacter` response.
 * The FE takes those prompts, calls its concrete adapter (DALL-E, Stability AI,
 * etc.), stores the results, and reports back via `recordImageBeat`.
 *
 * Wired behind the OUTWARD root (never the engine root) — portrait prompts are
 * built only from visible state; nothing here reaches VaultStore or SoulStore.
 */
export interface ImageGenerationRequest {
  prompt: string;
  /** Per-season photorealistic style anchor — seeded at cast time, stable through the season. */
  styleAnchor: string;
  /** Houseguest id or scene description (for recording / dedup). */
  subject: string;
}

export interface ImageGenerationResult {
  /** Base64-encoded image data or a URL, depending on provider. */
  imageData: string;
  format: "url" | "base64";
}

export interface ImageGenerationPort {
  generate(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
  /**
   * Whether a concrete image-capable provider is wired. When false, the FE
   * must decline in the production frame ("feeds are down") — never an error
   * surface, never a broken affordance (ADR 0003 / spec §2 decision #5).
   */
  isAvailable(): boolean;
}
