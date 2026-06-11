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
 * Lane G8 — a soul-write batch must let the event loop BREATHE. The real embedder
 * (ADR 0004) is a synchronous worker bridge: each `embed()` call blocks the Node
 * event loop for the inference. A bulk batch used to run every embed back-to-back
 * inside one synchronous call — pinning the loop for the whole batch, so `/health`
 * (and every concurrent request) stalled and the front-end reported a false outage.
 * The fix keeps BOTH contracts intact:
 *
 * - the AUTHORITATIVE soul (narrative + memories) still updates synchronously in
 *   `recordToSoul` — lossless, monotonic, snapshot-visible (0007/0030);
 * - each embed is still ONE synchronous call on the ADR 0004 seam — only the
 *   *spacing* changes: indexing is queued and drained one memory per macrotask
 *   (`setImmediate`), so the loop serves I/O between embed calls.
 *
 * Lane G12 — the breathing batch lane is SHARED process-wide, at the seam. G8's
 * queue/drain lived per instance: every SoulStore (one per user sandbox) ran its own
 * `setImmediate` chain, so N sandboxes flooding together — the boot preload restores
 * EVERY saved user (`composeRuntime`), several restores landing in one tick — put up
 * to N back-to-back embeds into a single check phase: stalls stacked to N × one
 * inference. The drain is now ONE module-wide lane, mirroring the one ONNX worker
 * that actually serves every sandbox (ADR 0004): the loop never carries more than a
 * single embed per macrotask NO MATTER how many sandboxes are bursting, and every
 * present or future burst site inherits the breathing by construction the moment it
 * calls `recordToSoul`:
 *
 *   - creation-time seeding (G8's original case — casting finalization, and the
 *     season-restart re-seeding through the one restart door, D1/R1);
 *   - `rebuildSoulIndex` replaying a whole season's arc on restore (0030), including
 *     the boot preload over every saved user;
 *   - the eviction-night / finale fold+confessional bursts and the per-turn
 *     off-screen tick (0040/0041 via `GameSessionAdapter`).
 *
 * Teardown hygiene (G12): when a sandbox is dropped or replaced (season reset,
 * rollback restore, LRU unload, a refused resume), `discardPending` drops ITS queued
 * index work — derived state for indexes about to be garbage — so a dead season's
 * backlog never delays a live one's drain or burns inference on the shared lane.
 *
 * Correctness: the vector index is DERIVED state. `recall` flushes any still-queued
 * memories for that houseguest (this store only) synchronously first, so a recall is
 * always complete — callers observe exactly the old semantics, just without the loop
 * pinned.
 */
export class SoulStore implements SoulProvider {
  // ── The ONE shared breathing lane (G8 spacing; G12 hoisted process-wide) ──────
  /** Memories recorded but not yet embedded into a (derived) vector index — ALL stores. */
  private static readonly pending: Array<{ store: SoulStore; hg: EntityId; mem: Memory }> = [];
  private static drainScheduled = false;

  /** Drain ONE queued embed per macrotask — process-wide — so /health and concurrent
   *  requests answer between embeds no matter how many sandboxes are bursting at once. */
  private static scheduleDrain(): void {
    if (SoulStore.drainScheduled || SoulStore.pending.length === 0) return;
    SoulStore.drainScheduled = true;
    setImmediate(() => {
      SoulStore.drainScheduled = false;
      const next = SoulStore.pending.shift();
      if (next) next.store.indexOne(next.hg, next.mem);
      SoulStore.scheduleDrain();
    });
  }

  /** Queued (not-yet-embedded) index entries across EVERY store — test/ops visibility. */
  static pendingTotal(): number {
    return SoulStore.pending.length;
  }

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
    // G8/G12: queue the (derived) vector indexing on the shared lane instead of embedding
    // inline — no soul-write burst, from any sandbox, ever pins the event loop.
    SoulStore.pending.push({ store: this, hg, mem });
    SoulStore.scheduleDrain();
    return mem;
  }

  /** This store's still-queued (not-yet-embedded) index entries — test/ops visibility. */
  pendingCount(): number {
    let n = 0;
    for (const p of SoulStore.pending) if (p.store === this) n++;
    return n;
  }

  /**
   * Drop this store's queued index work from the shared lane (G12) — called when the
   * owning sandbox is dropped or replaced. Derived state only: the authoritative soul
   * is untouched, and a restore re-derives every index (`rebuildSoulIndex`).
   */
  discardPending(): void {
    const keep = SoulStore.pending.filter((p) => p.store !== this);
    SoulStore.pending.length = 0;
    SoulStore.pending.push(...keep);
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

  /** Synchronously index everything still queued for `hg` IN THIS STORE — a recall must
   *  see a complete index; other sandboxes' backlogs stay on the breathing lane. */
  private flushPending(hg: EntityId): void {
    if (SoulStore.pending.length === 0) return;
    const keep: Array<{ store: SoulStore; hg: EntityId; mem: Memory }> = [];
    for (const p of SoulStore.pending) {
      if (p.store === this && p.hg === hg) this.indexOne(p.hg, p.mem);
      else keep.push(p);
    }
    SoulStore.pending.length = 0;
    SoulStore.pending.push(...keep);
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
