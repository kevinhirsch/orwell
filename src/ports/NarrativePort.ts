import type { EntityId } from "../domain/ids";
import type { GameEvent } from "../domain/event";
import type { KnowledgeFact } from "../domain/knowledge";

export type NarrationMode = "scene" | "dialogue";

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
}

export interface NarrativePort {
  narrate(context: NarrationContext): string;
}
