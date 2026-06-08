import type { VectorIndex, VectorMatch } from "../../ports/VectorIndex";

/**
 * ENGINE-ONLY in-memory vector index (feature 0024) — cosine-similarity recall over
 * Vault-side soul embeddings. No outward module may depend on it (dependency-cruiser),
 * exactly like the Vault. sqlite-vec → pgvector adapters land later behind this port.
 */
export class InMemoryVectorIndex implements VectorIndex {
  private readonly items = new Map<string, { vector: number[]; meta?: Record<string, unknown> }>();

  upsert(id: string, vector: readonly number[], meta?: Record<string, unknown>): void {
    this.items.set(id, { vector: [...vector], ...(meta ? { meta } : {}) });
  }

  query(vector: readonly number[], k: number): VectorMatch[] {
    return [...this.items.entries()]
      .map(([id, it]) => ({ id, score: cosine(vector, it.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, k));
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
