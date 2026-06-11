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
 *
 * Lane G8 — the seeding batch must let the event loop BREATHE. The real embedder
 * (ADR 0004) is a synchronous worker bridge: each `embed()` call blocks the Node
 * event loop for the inference. A bulk seeding batch (the creation-time folds of a
 * brand-new house, `rebuildSoulIndex` replaying a late-season arc on restore) used
 * to run every embed back-to-back inside one synchronous call — pinning the loop
 * for the whole batch, so `/health` (and every concurrent request) stalled and the
 * front-end reported a false outage. The fix keeps BOTH contracts intact:
 *
 * - the AUTHORITATIVE soul (narrative + memories) still updates synchronously in
 *   `recordToSoul` — lossless, monotonic, snapshot-visible (0007/0030);
 * - each embed is still ONE synchronous call on the ADR 0004 seam — only the
 *   *spacing* changes: indexing is queued and drained one memory per macrotask
 *   (`setImmediate`), so the loop serves I/O between per-soul embed calls.
 *
 * Correctness: the vector index is DERIVED state. `recall` flushes any still-queued
 * memories for that houseguest synchronously first, so a recall is always complete
 * — callers observe exactly the old semantics, just without the loop pinned.
 */
export class SoulStore implements SoulProvider {
  private readonly souls = new Map<EntityId, Soul>();
  private readonly indexes = new Map<EntityId, VectorIndex>();
  private seq = 0;
  /** Memories recorded but not yet embedded into the (derived) vector index (G8). */
  private readonly pendingIndex: Array<{ hg: EntityId; mem: Memory }> = [];
  private drainScheduled = false;

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
    // G8: queue the (derived) vector indexing instead of embedding inline — a creation/restore
    // seeding batch no longer pins the event loop for the whole house's worth of sync embeds.
    this.pendingIndex.push({ hg, mem });
    this.scheduleDrain();
    return mem;
  }

  /** Drain ONE queued embed per macrotask so /health and concurrent requests answer in between. */
  private scheduleDrain(): void {
    if (this.drainScheduled || this.pendingIndex.length === 0) return;
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      const next = this.pendingIndex.shift();
      if (next) this.indexOne(next.hg, next.mem);
      this.scheduleDrain();
    });
  }

  /** One synchronous embed+upsert (the ADR 0004 sync-per-call seam, unchanged). */
  private indexOne(hg: EntityId, mem: Memory): void {
    try {
      this.indexFor(hg).upsert(mem.id, this.embed(mem.content), { content: mem.content });
    } catch {
      // Vectors are derived state: a failed embed only degrades recall for this memory
      // (a restart re-derives every index); it must never crash the drain loop.
    }
  }

  /** Synchronously index everything still queued for `hg` — a recall must see a complete index. */
  private flushPending(hg: EntityId): void {
    if (this.pendingIndex.length === 0) return;
    const keep: Array<{ hg: EntityId; mem: Memory }> = [];
    for (const p of this.pendingIndex) {
      if (p.hg === hg) this.indexOne(p.hg, p.mem);
      else keep.push(p);
    }
    this.pendingIndex.length = 0;
    this.pendingIndex.push(...keep);
  }

  recall(hg: EntityId, context: string, k = 3): Memory[] {
    this.flushPending(hg); // G8: the deferred indexing is invisible to recall semantics
    const idx = this.indexes.get(hg);
    const soul = this.souls.get(hg);
    if (!idx || !soul) return [];
    const byId = new Map(soul.memories.map((m) => [m.id, m]));
    return idx.query(this.embed(context), k)
      .map((match) => byId.get(match.id))
      .filter((m): m is Memory => m !== undefined);
  }
}
