/**
 * Turns text into vectors for the engine-only `VectorIndex`. A deterministic
 * fake is wired for offline / seeded tests; a real provider at runtime. Concrete
 * implementations land with the soul/character features.
 */
export interface EmbeddingProvider {
  embed(text: string): number[] | Promise<number[]>;
}
