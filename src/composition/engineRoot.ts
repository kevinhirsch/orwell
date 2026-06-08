import { InMemoryEventStore } from "../adapters/inmemory/InMemoryEventStore";
import { InMemoryVaultStore } from "../adapters/inmemory/InMemoryVaultStore";
import { InMemoryKnowledgeService } from "../adapters/inmemory/InMemoryKnowledgeService";
import { RelationshipModel } from "../engine/relationships";
import type { EventStore } from "../ports/EventStore";
import type { VaultStore } from "../ports/VaultStore";
import type { KnowledgeService } from "../ports/KnowledgeService";

/**
 * Engine composition root. This is the ONLY place the Vault is wired. Outward
 * channels are composed separately (see `outwardRoot.ts`) and are handed only
 * the non-Vault ports — so no outward module ever gets a Vault handle.
 */
export interface EngineCore {
  events: EventStore;
  /** ENGINE-ONLY. Never passed to an outward channel. */
  vault: VaultStore;
  knowledge: KnowledgeService;
  /** ENGINE-ONLY hidden opinion layer (0017/0023). Updated by actions; never surfaced. */
  relationships: RelationshipModel;
}

export function buildEngineCore(): EngineCore {
  const events = new InMemoryEventStore();
  const vault = new InMemoryVaultStore();
  const knowledge = new InMemoryKnowledgeService(events);
  const relationships = new RelationshipModel(0.5);
  return { events, vault, knowledge, relationships };
}
