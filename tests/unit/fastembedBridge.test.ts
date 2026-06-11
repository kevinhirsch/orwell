import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { FastembedEmbedding } from "../../src/adapters/embedding/FastembedEmbedding";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { buildEngineCore, setRuntimeEmbedding } from "../../src/composition/engineRoot";

/**
 * ADR 0004 / E86a — the fastembed adapter's SYNC bridge, proven against protocol-faithful
 * fake workers (no ONNX, no network, no model: per the ADR, no test may depend on real
 * embeddings — the real-model integration test is opt-in, tests/integration/fastembedReal).
 * Roles only; no houseguest names.
 */
const workerUrl = (name: string): URL => new URL(`../support/${name}`, import.meta.url);
void fileURLToPath; // (kept for debugging path issues across runners)

let provider: FastembedEmbedding | null = null;
afterEach(async () => {
  await provider?.dispose();
  provider = null;
  setRuntimeEmbedding(null);
});

describe("FastembedEmbedding — the synchronous worker bridge (E86a)", () => {
  it("warms up against the worker and serves real synchronous embeds in the worker's space", async () => {
    provider = await FastembedEmbedding.create({
      workerUrl: workerUrl("fakeEmbedWorker.mjs"),
      cacheDir: "/tmp/unused",
      initTimeoutMs: 10_000,
    });
    expect(provider.dim).toBe(8);
    const a = provider.embed("the veto betrayal");
    const b = provider.embed("the veto betrayal");
    const c = provider.embed("a completely different memory");
    expect(a).toHaveLength(8);
    expect(a).toEqual(b); // deterministic per text
    expect(a).not.toEqual(c); // discriminates content
    expect(provider.degraded).toBe(false);
  });

  it("a stalled worker degrades the provider PERMANENTLY to the deterministic fallback (the game never breaks)", async () => {
    provider = await FastembedEmbedding.create({
      workerUrl: workerUrl("stallEmbedWorker.mjs"),
      cacheDir: "/tmp/unused",
      initTimeoutMs: 10_000,
      embedTimeoutMs: 150,
    });
    const det = new DeterministicEmbedding();
    const v = provider.embed("some memory"); // times out inside, falls back
    expect(provider.degraded).toBe(true);
    expect(v).toEqual(det.embed("some memory")); // the sanctioned fallback space
    // Permanently: subsequent calls never touch the dead worker, stay fallback-space.
    expect(provider.embed("another")).toEqual(det.embed("another"));
  });

  it("a failed warm-up rejects, so composition can fall back to the deterministic provider for the whole process", async () => {
    await expect(
      FastembedEmbedding.create({
        workerUrl: workerUrl("initFailEmbedWorker.mjs"),
        cacheDir: "/tmp/unused",
        initTimeoutMs: 10_000,
      }),
    ).rejects.toThrow(/no model in this environment/);
  });
});

describe("engineRoot composition (ADR 0004 fallback semantics)", () => {
  it("without an injected runtime provider, souls embed via the deterministic provider", () => {
    const calls: string[] = [];
    setRuntimeEmbedding({
      embed: (t) => {
        calls.push(t);
        return [1, 0];
      },
    });
    setRuntimeEmbedding(null); // cleared again — the default path must not use it
    const core = buildEngineCore();
    core.soul.recordToSoul("npc:1", "a quiet kitchen conversation");
    expect(calls).toHaveLength(0); // the cleared override was never consulted
    // recall still works (deterministic space):
    const got = core.soul.recall("npc:1", "kitchen conversation", 1);
    expect(got).toHaveLength(1);
  });

  it("an injected runtime provider is what every new sandbox's SoulStore embeds with", async () => {
    const calls: string[] = [];
    setRuntimeEmbedding({
      embed: (t) => {
        calls.push(t);
        const v = new Array(4).fill(0);
        for (let i = 0; i < t.length; i++) v[i % 4]! += t.charCodeAt(i);
        return v;
      },
    });
    const core = buildEngineCore();
    core.soul.recordToSoul("npc:1", "a memory recorded through the injected provider");
    // G8: indexing is deferred (one sync embed per macrotask, so a seeding batch never pins
    // the event loop) — drain a tick, then the INJECTED provider must be the one consulted.
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls.length).toBeGreaterThan(0);
  });
});
