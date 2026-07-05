import { describe, it, expect } from "vitest";
import { createEmbeddingsStatusTracker } from "../../src/adapters/embedding/embeddingsStatus";

// PERSIST-5 — the /health embeddings-provider status must reflect a MID-PROCESS degrade, not just a
// point-in-time boot snapshot. `main.ts`'s previous `embeddingsState` was assigned once, right after a
// successful warm-up (when `degraded` is definitionally false), and never re-read the provider's live
// flag afterward — so an operator watching /health could never see a worker crash/timeout that
// degrades recall to the deterministic fallback later in the process's life (the same failure PERSIST-1
// depends on being visible). This is a source-level unit test for the extracted tracker (main.ts itself
// is a boot script with no test harness — see CLAUDE.md's `test:cov` exclusion for `src/main.ts`).
describe("PERSIST-5 — embeddings status tracker reflects a LIVE mid-process degrade", () => {
  it("defaults to the deterministic, non-degraded boot state before any provider is wired", () => {
    const tracker = createEmbeddingsStatusTracker();
    expect(tracker.status()).toEqual({ provider: "deterministic", degraded: false });
  });

  it("reports the boot-time snapshot once a healthy provider warms up", () => {
    const tracker = createEmbeddingsStatusTracker();
    tracker.setLiveProvider({ degraded: false });
    tracker.setBootState({ provider: "fastembed", degraded: false });
    expect(tracker.status()).toEqual({ provider: "fastembed", degraded: false });
  });

  it("a warm-up-time failure is captured by the boot snapshot alone (no live provider ever set)", () => {
    const tracker = createEmbeddingsStatusTracker();
    tracker.setBootState({ provider: "deterministic", degraded: true });
    expect(tracker.status()).toEqual({ provider: "deterministic", degraded: true });
  });

  it("THE FIX: a MID-PROCESS degrade (the live provider's flag flips AFTER a healthy boot) is reflected on the next status() call, even though the boot snapshot never changes", () => {
    const tracker = createEmbeddingsStatusTracker();
    const provider = { degraded: false };
    tracker.setLiveProvider(provider);
    tracker.setBootState({ provider: "fastembed", degraded: false });
    expect(tracker.status()).toEqual({ provider: "fastembed", degraded: false });

    // The worker crashes/times out mid-process — FastembedEmbedding flips its OWN `degraded` flag.
    // Nothing calls `setBootState` again (the old bug: only a fresh warm-up ever updated the snapshot).
    (provider as { degraded: boolean }).degraded = true;

    expect(tracker.status()).toEqual({ provider: "deterministic", degraded: true });
  });

  it("recovers to reporting the boot state if the live provider reference is cleared", () => {
    const tracker = createEmbeddingsStatusTracker();
    tracker.setLiveProvider({ degraded: true });
    tracker.setBootState({ provider: "fastembed", degraded: false });
    expect(tracker.status().degraded).toBe(true);

    tracker.setLiveProvider(null);
    expect(tracker.status()).toEqual({ provider: "fastembed", degraded: false });
  });
});
