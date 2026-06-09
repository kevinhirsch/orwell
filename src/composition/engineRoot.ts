import { InMemoryEventStore } from "../adapters/inmemory/InMemoryEventStore";
import { InMemoryVaultStore } from "../adapters/inmemory/InMemoryVaultStore";
import { InMemoryKnowledgeService } from "../adapters/inmemory/InMemoryKnowledgeService";
import { RelationshipModel } from "../engine/relationships";
import { SoulStore } from "../adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../adapters/embedding/DeterministicEmbedding";
import type { EventStore } from "../ports/EventStore";
import type { VaultStore } from "../ports/VaultStore";
import type { KnowledgeService } from "../ports/KnowledgeService";
import type { SoulProvider } from "../ports/SoulProvider";

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
  /**
   * ENGINE-ONLY dynamic soul (0024): md narrative + vector recall, now wired into the LIVE
   * sandbox (the 0041 linchpin) so `recordToSoul`/`recall` run during play — the house's souls
   * deepen between turns and an NPC's voice can be grounded in their own history. Like the Vault,
   * no outward module may depend on it (dependency-cruiser).
   */
  soul: SoulProvider;
}

export function buildEngineCore(): EngineCore {
  const events = new InMemoryEventStore();
  const vault = new InMemoryVaultStore();
  const knowledge = new InMemoryKnowledgeService(events);
  const relationships = new RelationshipModel(0.5);
  // Deterministic offline embedding (0024) so live recall is reproducible in seeded play/tests; a
  // real embedding model behind EmbeddingProvider is the one still-open decision (CLAUDE.md §4).
  const embedding = new DeterministicEmbedding();
  const soul = new SoulStore((text) => embedding.embed(text));
  return { events, vault, knowledge, relationships, soul };
}
