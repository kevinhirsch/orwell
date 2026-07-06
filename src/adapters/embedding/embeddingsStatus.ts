/**
 * PERSIST-5 — a small, dependency-free tracker for the `/health` embeddings-provider status (the
 * admin Health & Logs card).
 *
 * `main.ts` used to cache a single point-in-time snapshot, assigned exactly once immediately after a
 * successful warm-up (at which point `degraded` is definitionally `false` — degrade only ever happens
 * on a LATER failed `embed()` call, e.g. a worker timeout/crash while the game is already live).
 * Nothing ever re-read the provider's live `degraded` flag after that, so `/health` was structurally
 * incapable of ever reporting a mid-process degrade — an operator would see "fastembed: healthy"
 * forever even after recall had silently fallen back to the deterministic embedder (the exact failure
 * PERSIST-1's dimension guard/self-heal depends on being visible when it fires repeatedly).
 *
 * The fix: hold the live provider reference alongside the boot-time snapshot, and re-check its
 * CURRENT `.degraded` flag on every `status()` call. A warm-up-time failure (no provider ever set)
 * still reports via the boot snapshot alone — correct, since that failure is permanent for the run.
 */
export interface EmbeddingsStatus {
  provider: string;
  degraded: boolean;
}

export interface EmbeddingsStatusTracker {
  /** The current status — re-checks the live provider's `degraded` flag on every call. */
  status: () => EmbeddingsStatus;
  /** Set the boot-time snapshot (a warm-up success/failure outcome). */
  setBootState: (state: EmbeddingsStatus) => void;
  /** Wire the live provider reference so a LATER mid-process degrade is reflected; `null` = none yet. */
  setLiveProvider: (provider: { readonly degraded: boolean } | null) => void;
}

export function createEmbeddingsStatusTracker(): EmbeddingsStatusTracker {
  let bootState: EmbeddingsStatus = { provider: "deterministic", degraded: false };
  let liveProvider: { readonly degraded: boolean } | null = null;
  return {
    status: (): EmbeddingsStatus =>
      liveProvider?.degraded ? { provider: "deterministic", degraded: true } : bootState,
    setBootState: (state: EmbeddingsStatus): void => {
      bootState = state;
    },
    setLiveProvider: (provider: { readonly degraded: boolean } | null): void => {
      liveProvider = provider;
    },
  };
}
