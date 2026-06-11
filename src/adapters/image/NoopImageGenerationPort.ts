import type { ImageGenerationPort, ImageGenerationRequest, ImageGenerationResult } from "../../ports/ImageGenerationPort";

/**
 * Null adapter — used when no image-capable provider is configured (0051 §2 decision #5).
 *
 * `isAvailable()` returns false so every caller can gate gracefully in the production frame
 * ("the feeds can't render that") without any error surface. `generate()` throws if somehow
 * reached — it should only be called after checking `isAvailable()`.
 */
export class NoopImageGenerationPort implements ImageGenerationPort {
  isAvailable(): boolean {
    return false;
  }

  async generate(_req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    throw new Error(
      "NoopImageGenerationPort: no image-capable provider is configured — check isAvailable() before calling generate()",
    );
  }
}
