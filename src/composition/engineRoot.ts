import { InMemoryEventStore } from "../adapters/inmemory/InMemoryEventStore";
import { InMemoryVaultStore } from "../adapters/inmemory/InMemoryVaultStore";
import { InMemoryKnowledgeService } from "../adapters/inmemory/InMemoryKnowledgeService";
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
}

export function buildEngineCore(): EngineCore {
  const events = new InMemoryEventStore();
  const vault = new InMemoryVaultStore();
  const knowledge = new InMemoryKnowledgeService(events);
  return { events, vault, knowledge };
}
