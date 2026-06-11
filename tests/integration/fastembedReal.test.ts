import { describe, it, expect } from "vitest";

/**
 * OPT-IN real-model integration (ADR 0004 / E86a): downloads/loads the pinned BGE model and
 * proves semantic discrimination end-to-end through the real worker. Never runs in CI or the
 * default gate (the deterministic fake is the sanctioned test adapter) — enable explicitly:
 *
 *   npm run build && ORWELL_TEST_FASTEMBED=1 npx vitest run tests/integration/fastembedReal.test.ts
 *
 * Requires dist/embedWorker.js (npm run build) and either a cached model
 * (ORWELL_EMBED_CACHE or /tmp/orwell-embed-cache) or network access to fetch it.
 */
const enabled = process.env["ORWELL_TEST_FASTEMBED"] === "1";

describe.skipIf(!enabled)("fastembed real-model integration (opt-in)", () => {
  it("loads the pinned model and ranks semantically related text above unrelated text", async () => {
    const { FastembedEmbedding } = await import("../../src/adapters/embedding/FastembedEmbedding");
    const provider = await FastembedEmbedding.create({
      workerUrl: new URL("../../dist/embedWorker.js", import.meta.url),
      cacheDir: process.env["ORWELL_EMBED_CACHE"] || "/tmp/orwell-embed-cache",
      initTimeoutMs: 300_000, // first run may download the model
    });
    try {
      const cos = (a: number[], b: number[]): number => {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
        return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
      };
      const memory = provider.embed("they promised safety this week and then voted to evict me");
      const related = provider.embed("a broken promise about the eviction vote");
      const unrelated = provider.embed("the kitchen ran out of coffee this morning");
      expect(provider.degraded).toBe(false);
      expect(memory.length).toBeGreaterThanOrEqual(256); // a real model dim, not the 8-dim fake
      expect(cos(memory, related)).toBeGreaterThan(cos(memory, unrelated));
    } finally {
      await provider.dispose();
    }
  }, 360_000);
});
