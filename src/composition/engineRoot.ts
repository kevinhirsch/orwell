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

/**
 * Process-wide runtime embedding override (ADR 0004 / E86a). The fastembed provider is a
 * process SINGLETON (one ONNX worker serves every sandbox), warmed up once at boot by
 * main.ts and injected here BEFORE any sandbox is built — so every index in the process
 * lives in one vector space (mixing spaces inside an index breaks cosine recall; restarts
 * re-derive all indexes via rebuildSoulIndex, so the space may differ per process, never
 * within one). Tests and any environment without the model never set it and compose the
 * deterministic fake — exactly the ADR's fallback semantics. Must be a SYNC embedder
 * (the SoulStore seam is synchronous by design).
 */
let runtimeEmbedding: { embed(text: string): number[] } | null = null;
export function setRuntimeEmbedding(provider: { embed(text: string): number[] } | null): void {
  runtimeEmbedding = provider;
}

export function buildEngineCore(): EngineCore {
  const events = new InMemoryEventStore();
  const vault = new InMemoryVaultStore();
  const knowledge = new InMemoryKnowledgeService(events);
  const relationships = new RelationshipModel(0.5);
  // The injected runtime provider (fastembed, ADR 0004) when main.ts warmed one up at boot;
  // otherwise the deterministic offline embedding (0024) — reproducible seeded recall, and
  // the sanctioned whole-process fallback when the real model is unavailable.
  const embedding = runtimeEmbedding ?? new DeterministicEmbedding();
  const soul = new SoulStore((text) => embedding.embed(text));
  return { events, vault, knowledge, relationships, soul };
}
