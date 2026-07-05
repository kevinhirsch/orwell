import { VectorDimMismatchError, type VectorIndex, type VectorMatch } from "../../ports/VectorIndex";

/**
 * ENGINE-ONLY in-memory vector index (feature 0024) — cosine-similarity recall over
 * Vault-side soul embeddings. No outward module may depend on it (dependency-cruiser),
 * exactly like the Vault. sqlite-vec → pgvector adapters land later behind this port.
 *
 * PERSIST-1 dimension guard: the index pins its dimension on the FIRST `upsert` and rejects
 * (throws `VectorDimMismatchError`) any later vector of a different length instead of silently
 * truncating the cosine sum to `Math.min(a.length, b.length)` — the old behavior produced a
 * meaningless-but-plausible-looking score with zero error whenever a mid-process embedder
 * change (a fastembed degrade, or the boot warm-up race — PERSIST-4) mixed two vector spaces
 * inside one houseguest's index. `query` fails safe the same way: a query vector of the wrong
 * dimension can never be compared against this index's vectors, so it returns no matches rather
 * than a garbage ranking.
 */
export class InMemoryVectorIndex implements VectorIndex {
  private readonly items = new Map<string, { vector: number[]; meta?: Record<string, unknown> }>();
  private dim: number | null = null;

  upsert(id: string, vector: readonly number[], meta?: Record<string, unknown>): void {
    if (this.dim === null) this.dim = vector.length;
    else if (vector.length !== this.dim) throw new VectorDimMismatchError(this.dim, vector.length);
    this.items.set(id, { vector: [...vector], ...(meta ? { meta } : {}) });
  }

  query(vector: readonly number[], k: number): VectorMatch[] {
    if (this.dim !== null && vector.length !== this.dim) return []; // fail safe: not a comparable space
    return [...this.items.entries()]
      .map(([id, it]) => ({ id, score: cosine(vector, it.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, k));
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  // Both operands are guaranteed equal length by the upsert/query dimension guard above; the
  // Math.min stays only as defensive belt-and-suspenders, never as the mechanism that tolerates
  // a real mismatch (that path now throws/short-circuits before reaching here).
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
