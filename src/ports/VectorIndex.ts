/**
 * ENGINE-ONLY PORT — vector index over Vault-side soul data, reached only
 * through `SoulProvider`. Like `VaultStore`, no outward module may depend on it
 * (enforced by dependency-cruiser). Concrete adapters (sqlite-vec now →
 * pgvector later) land with the soul/character features.
 */
export interface VectorMatch {
  id: string;
  score: number;
}

export interface VectorIndex {
  upsert(id: string, vector: readonly number[], meta?: Record<string, unknown>): void;
  query(vector: readonly number[], k: number): VectorMatch[];
}

/**
 * Thrown by a `VectorIndex.upsert` when a vector's dimension doesn't match the dimension the
 * index pinned on its FIRST write (I5: one embedder, one space per index — mixing dimensions
 * inside one index turns cosine similarity into a meaningless, silently-wrong number, never an
 * error, unless every adapter guards this explicitly). Every `VectorIndex` implementation MUST
 * throw this instead of truncating or silently comparing mismatched vectors, so a caller
 * (`SoulStore`) can fail safe — rebuild the index in the new space rather than let a
 * stale-dimension vector corrupt recall.
 */
export class VectorDimMismatchError extends Error {
  constructor(
    readonly expectedDim: number,
    readonly actualDim: number,
    readonly indexId?: string,
  ) {
    super(
      `vector dimension mismatch: index is pinned to ${expectedDim}-dim, got ${actualDim}-dim` +
        (indexId ? ` (${indexId})` : ""),
    );
    this.name = "VectorDimMismatchError";
  }
}
