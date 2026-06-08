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
