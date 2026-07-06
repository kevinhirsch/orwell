import type { EntityId } from "../domain/ids";

/**
 * ENGINE-ONLY PORT (feature 0024). The dynamic Soul = a growing markdown narrative
 * + an engine-only vector index for SEMANTIC recall (the most relevant past beats,
 * not just the most recent). It holds Vault-side hidden soul data, so — like
 * `VaultStore` / `VectorIndex` — no outward module may depend on it
 * (dependency-cruiser). What reaches the player is pathway-filtered (0002).
 */
/**
 * The lightly-sectioned inner diary (feature 0024, PO ruling 2026-07-06 — Option B). The soul's
 * human-readable narrative is organised into three buckets rather than one flat stream:
 *  - `memory`  — things that happened (the default; the bulk of a soul).
 *  - `leaning` — who they lean toward / against (trust, alliance, targets — the strategic drift).
 *  - `feeling` — their emotional log (how a beat landed on them).
 * The section is DERIVED from the memory's content by a deterministic classifier (engine-only), so
 * it re-derives identically on restore and needs no persistence-schema change. Purely an
 * organisation of the hidden inner story — nothing here ever crosses to the player.
 */
export type SoulSection = "memory" | "leaning" | "feeling";

export interface Memory {
  id: string;
  content: string;
  ts: number;
  /** Which inner-diary section this memory files under (0024 Option B). Default `"memory"`. */
  section: SoulSection;
}

/** The dynamic, deepening soul: a human-readable narrative + its indexed memories. */
export interface Soul {
  narrative: string;
  memories: Memory[];
}

export interface SoulProvider {
  /** The dynamic soul (md narrative + memories) for a houseguest; created on first use. */
  soulOf(hg: EntityId): Soul;
  /**
   * Append a memory to the md narrative AND index it for recall — never deletes (0007). The
   * optional `section` (0024 Option B) files it under a specific inner-diary bucket; when omitted
   * the store classifies it deterministically from the content.
   */
  recordToSoul(hg: EntityId, content: string, section?: SoulSection): Memory;
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
