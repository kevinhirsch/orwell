// ENGINE-ONLY PORT.
//
// The vector index holds Vault-side soul data (semantic personality similarity, behavioral
// memory, conversation recall), so the SAME wall as VaultStore applies: no player-/admin-
// facing module may depend on it. Adopted from day one: sqlite-vec now -> pgvector later,
// reached only via SoulProvider. Embeddings sit behind a separate EmbeddingProvider port
// (with a deterministic fake for seeded/offline tests).

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
  readonly payload: string;
}

export interface VectorIndex {
  upsert(id: string, vector: readonly number[], payload: string): void;
  query(vector: readonly number[], k: number): readonly VectorMatch[];
}
