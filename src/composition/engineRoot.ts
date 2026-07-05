import { InMemoryEventStore } from "../adapters/inmemory/InMemoryEventStore";
import { InMemoryVaultStore } from "../adapters/inmemory/InMemoryVaultStore";
import { InMemoryKnowledgeService } from "../adapters/inmemory/InMemoryKnowledgeService";
import { RelationshipModel } from "../engine/relationships";
import { SoulStore } from "../adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../adapters/embedding/DeterministicEmbedding";
import { sqliteVectorIndexFactory } from "../adapters/sqlite/SqliteVectorIndex";
import type { EventStore } from "../ports/EventStore";
import type { VaultStore } from "../ports/VaultStore";
import type { KnowledgeService } from "../ports/KnowledgeService";
import type { SoulProvider } from "../ports/SoulProvider";
import type { VectorIndex } from "../ports/VectorIndex";
import type { EntityId } from "../domain/ids";

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
 * process SINGLETON (one ONNX worker serves every sandbox), warmed up once at boot by main.ts.
 * Tests and any environment without the model never set it and compose the deterministic fake
 * — exactly the ADR's fallback semantics. Must be a SYNC embedder (the SoulStore seam is
 * synchronous by design).
 *
 * PERSIST-4 (boot-time pin race): main.ts binds the HTTP server and starts answering requests
 * BEFORE `setRuntimeEmbedding` ever runs — the warm-up is deliberately deferred past `/health`
 * coming up (prod incident 2026-06-19: a cold/blocked model must never delay boot). That means a
 * sandbox CAN be built during the up-to-45s warm-up window. `buildEngineCore` used to resolve
 * `runtimeEmbedding ?? new DeterministicEmbedding()` ONCE, at build time, and close over that
 * value forever — so an early sandbox was pinned to the deterministic fallback for its entire
 * in-memory life, even after fastembed finished warming up moments later, while a sandbox built
 * a moment after warm-up got the real provider: two sandboxes in the SAME process, silently
 * disagreeing about which space they embed into, purely by timing.
 *
 * The fix: every `SoulStore` reads `runtimeEmbedding` LIVE, on every embed call, via the
 * `currentEmbedding` helper below — there is exactly one process-wide answer to "what's the
 * provider right now," consulted uniformly by every sandbox regardless of when it was built, so
 * the fastembed upgrade (and any later mid-process degrade) applies uniformly instead of forking
 * per-sandbox. A provider change can still mean a given houseguest's index sees a new vector
 * dimension mid-life; `SoulStore` closes that gap (PERSIST-1) by treating a `VectorDimMismatchError`
 * from `VectorIndex.upsert` as a signal to rebuild that houseguest's index in the new space
 * rather than ever comparing across two.
 */
let runtimeEmbedding: { embed(text: string): number[] } | null = null;
export function setRuntimeEmbedding(provider: { embed(text: string): number[] } | null): void {
  runtimeEmbedding = provider;
}

/** The sanctioned whole-process fallback (ADR 0004). `DeterministicEmbedding` is a pure function
 *  of its input text with no instance state, so any number of instances behave identically —
 *  kept as one constant purely so "the fallback" is provably a single, stable value. */
const FALLBACK_EMBEDDING: { embed(text: string): number[] } = new DeterministicEmbedding();

/** The live, current process-wide embedding provider — read fresh on every call (PERSIST-4). */
function currentEmbedding(text: string): number[] {
  return (runtimeEmbedding ?? FALLBACK_EMBEDDING).embed(text);
}

export function buildEngineCore(): EngineCore {
  const events = new InMemoryEventStore();
  const vault = new InMemoryVaultStore();
  const knowledge = new InMemoryKnowledgeService(events);
  const relationships = new RelationshipModel(0.5);
  // E63: `ORWELL_STORE=sqlite` backs each houseguest's recall index with sqlite-vec (SYNCHRONOUS, so
  // the SoulStore seam stays sync — the fastembed bridge + G8/G12 breathing lane are unaffected). One
  // shared vector db PER SANDBOX (each `buildEngineCore` call), so cross-user isolation holds. DEFAULT
  // unset ⇒ the in-memory cosine index (today's behavior — byte-identical, no sqlite import touched).
  //
  // PERSIST-7: the durable tier now persists the vector store to disk (`<ORWELL_DATA_DIR>/orwell-vec.sqlite`)
  // and keys each houseguest's table on their stable id, so semantic recall SURVIVES a process restart —
  // the whole point of opting into sqlite-vec (avoiding the O(events) re-embed replay the in-memory tier
  // pays on every resume, per I5 non-degradation). Previously the factory was called with NO path, so the
  // "durable" index was silently `:memory:` and every restart lost it.
  const makeIndex: ((hg?: EntityId, freshStart?: boolean) => VectorIndex) | undefined =
    (process.env.ORWELL_STORE ?? "").trim().toLowerCase() === "sqlite"
      ? sqliteVectorIndexFactory(vectorDbPath())
      : undefined;
  const soul = makeIndex ? new SoulStore(currentEmbedding, makeIndex) : new SoulStore(currentEmbedding);
  return { events, vault, knowledge, relationships, soul };
}

/** The on-disk path for the durable (sqlite-vec) recall store, derived from `ORWELL_DATA_DIR` exactly
 *  like `SqliteSaveStore`'s save file — a sibling `orwell-vec.sqlite`. Falls back to `./.orwell-data`,
 *  mirroring the save store's own default. Only consulted under `ORWELL_STORE=sqlite` (PERSIST-7). */
function vectorDbPath(): string {
  const dataDir = (process.env.ORWELL_DATA_DIR ?? process.env.BBAI_DATA_DIR ?? "./.orwell-data").replace(/\/+$/, "");
  return `${dataDir}/orwell-vec.sqlite`;
}
