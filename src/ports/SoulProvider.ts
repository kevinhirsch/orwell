import type { EntityId } from "../domain/ids";

/**
 * ENGINE-ONLY PORT (feature 0024). The dynamic Soul = a growing markdown narrative
 * + an engine-only vector index for SEMANTIC recall (the most relevant past beats,
 * not just the most recent). It holds Vault-side hidden soul data, so — like
 * `VaultStore` / `VectorIndex` — no outward module may depend on it
 * (dependency-cruiser). What reaches the player is pathway-filtered (0002).
 */
export interface Memory {
  id: string;
  content: string;
  ts: number;
}

/** The dynamic, deepening soul: a human-readable narrative + its indexed memories. */
export interface Soul {
  narrative: string;
  memories: Memory[];
}

export interface SoulProvider {
  /** The dynamic soul (md narrative + memories) for a houseguest; created on first use. */
  soulOf(hg: EntityId): Soul;
  /** Append a memory to the md narrative AND index it for recall — never deletes (0007). */
  recordToSoul(hg: EntityId, content: string): Memory;
  /** The k semantically-most-relevant past memories for `hg` given `context` (relevance, not recency). */
  recall(hg: EntityId, context: string, k?: number): Memory[];
  /**
   * Drop any DEFERRED derived-index work still queued for this provider (the breathing
   * batch lane, G8/G12: indexing is spaced across macrotasks so a soul-write burst never
   * pins the event loop). Called when the owning sandbox is dropped or replaced (season
   * restart, rollback restore, LRU unload) so a dead sandbox's backlog never delays a
   * live one's. Derived state only: the authoritative soul (narrative + memories) is
   * NEVER touched (0007), and a later restore re-derives every index (`rebuildSoulIndex`).
   */
  discardPending(): void;
}
