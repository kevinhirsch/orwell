import type { EmbeddingProvider } from "../../ports/EmbeddingProvider";

const DIM = 256; // wide enough that distinct vocabularies rarely hash-collide

/**
 * A deterministic, offline embedding for seeded tests (0001/0024): a normalized
 * bag-of-words hashed into a fixed-dim vector. Texts that share words cluster
 * (high cosine similarity), so recall is by CONTENT, not recency — a query about
 * "the veto betrayal" retrieves that betrayal, not last night's chat. No model,
 * no network; the same text always yields the same vector. NOTE: this is ALSO the
 * production adapter today — the accepted runtime target (fastembed, local ONNX,
 * version-pinned; ADR docs/decisions/0004) is not yet built, and this remains the
 * sanctioned fallback once it is (ADR 0004 "Implementation status", audit E86).
 */
export class DeterministicEmbedding implements EmbeddingProvider {
  embed(text: string): number[] {
    const v = new Array<number>(DIM).fill(0);
    for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) h = Math.imul(h ^ tok.charCodeAt(i), 16777619) >>> 0;
      v[h % DIM]! += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}
