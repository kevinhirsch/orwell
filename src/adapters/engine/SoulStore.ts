import type { EntityId } from "../../domain/ids";
import type { SoulProvider, Soul, Memory } from "../../ports/SoulProvider";
import type { VectorIndex } from "../../ports/VectorIndex";
import { InMemoryVectorIndex } from "../inmemory/InMemoryVectorIndex";

/**
 * ENGINE-ONLY soul store (feature 0024): per-houseguest dynamic Soul = a growing
 * markdown narrative + a per-houseguest vector index for SEMANTIC recall. Recall
 * runs over the FULL (hidden) soul engine-side; only pathway-filtered results ever
 * reach the player (0002). Holds Vault-side data — no outward module depends on it.
 *
 * `embed` is injected (the deterministic fake in tests; a real model at runtime).
 */
export class SoulStore implements SoulProvider {
  private readonly souls = new Map<EntityId, Soul>();
  private readonly indexes = new Map<EntityId, VectorIndex>();
  private seq = 0;

  constructor(
    private readonly embed: (text: string) => number[],
    private readonly makeIndex: () => VectorIndex = () => new InMemoryVectorIndex(),
  ) {}

  soulOf(hg: EntityId): Soul {
    let soul = this.souls.get(hg);
    if (!soul) { soul = { narrative: "", memories: [] }; this.souls.set(hg, soul); }
    return soul;
  }

  private indexFor(hg: EntityId): VectorIndex {
    let idx = this.indexes.get(hg);
    if (!idx) { idx = this.makeIndex(); this.indexes.set(hg, idx); }
    return idx;
  }

  recordToSoul(hg: EntityId, content: string): Memory {
    const soul = this.soulOf(hg);
    const mem: Memory = { id: `mem:${hg}:${++this.seq}`, content, ts: this.seq };
    soul.memories.push(mem);
    soul.narrative += (soul.narrative ? "\n" : "") + content; // append; never overwrite (0007)
    this.indexFor(hg).upsert(mem.id, this.embed(content), { content });
    return mem;
  }

  recall(hg: EntityId, context: string, k = 3): Memory[] {
    const idx = this.indexes.get(hg);
    const soul = this.souls.get(hg);
    if (!idx || !soul) return [];
    const byId = new Map(soul.memories.map((m) => [m.id, m]));
    return idx.query(this.embed(context), k)
      .map((match) => byId.get(match.id))
      .filter((m): m is Memory => m !== undefined);
  }
}
