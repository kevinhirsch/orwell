import type { EntityId } from "../domain/ids";
import type { GameEvent } from "../domain/event";
import type { KnowledgeFact } from "../domain/knowledge";

export type NarrationMode = "scene" | "dialogue";

/** Player-directed scene fidelity (0012): a compressed beat vs a full scene. */
export type SceneFidelity = "compressed" | "full";

/**
 * The ONLY thing the narrative layer (the LLM) ever receives. Assembled by an
 * outward surface from the visible projection — it contains no Vault data, so
 * nothing Vault-derived is in scope for the model to infer from.
 */
export interface NarrationContext {
  forEntity: EntityId;
  mode: NarrationMode;
  visibleEvents: GameEvent[];
  knowledge: KnowledgeFact[];
  /** Player-directed rendering fidelity; affects narration only, never ground truth. */
  fidelity?: SceneFidelity;
  /**
   * The managed, Vault-free moment system prompt (0018), when narrating a live
   * moment. Persona/framing only — proven sentinel-free; never Vault data.
   */
  systemPrompt?: string;
}

export interface NarrativePort {
  narrate(context: NarrationContext): string;
}
