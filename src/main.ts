import { composeRuntime } from "./composition/runtime";
import { startHttpMcp } from "./adapters/mcp/HttpMcpServer";

/**
 * target). Brings up the permissioned MCP server over HTTP; the Orwell
 * front-end connects to it via `ORWELL_ENGINE_MCP_URL`. Port comes from the
 * environment (no secrets here) — `ORWELL_ENGINE_PORT` is the documented engine
 * port (8765, per docs/INSTALL.md); `ORWELL_PORT` is kept as a legacy fallback.
 */
// parseInt + trim guards against stray whitespace or inline-comment fragments that some
// systemd EnvironmentFile parsers pass through (a real crash we hit: Number("8765 # ...") → NaN).
function parsePort(raw: string | undefined, fallback: number): number {
  const n = parseInt((raw ?? "").trim(), 10);
  return n > 0 && n < 65536 ? n : fallback;
}
// ORWELL_* are the primary names; BBAI_* are kept as silent deprecated fallbacks so a pre-rename
// .env keeps working.
const port = parsePort(
  process.env["ORWELL_ENGINE_PORT"] ?? process.env["BBAI_ENGINE_PORT"] ??
  process.env["ORWELL_PORT"] ?? process.env["BBAI_PORT"],
  8765,
);
// The live runtime (0035): one long-lived per-user registry (0021) — each authenticated user
// (asserted over the x-orwell-user header) gets an isolated sandbox, recalled from a disk-backed
// save store (0030) so a started game survives an engine restart. The game clock is the player's
// play-clock (ruling 2026-06-10): the DEFAULT is pure turn-driven (ORWELL_WATCHER_TICK_MS=0) — the
// house lives between the player's own turns (one bounded off-screen tick per turn) and does NOT
// exist while the player is away. The wall-clock watcher (0031/0035) is an opt-in operator knob
// (ORWELL_WATCHER_* env); data dir from ORWELL_DATA_DIR (BBAI_DATA_DIR legacy fallback).
// Semantic recall provider (ADR 0004 / E86a): ORWELL_EMBEDDINGS=fastembed (the deploy
// default — orwell-install.sh writes it and prefetches the pinned model) warms up the real
// local-ONNX provider BEFORE any sandbox exists, committing the whole process to one vector
// space. Any warm-up failure (no model cache + no network, missing native runtime) falls
// back to the deterministic provider for the WHOLE process — recall degrades gracefully,
// the game never breaks, and the next restart may upgrade again. Unset/anything-else keeps
// the deterministic provider (tests, dev).
const embedMode = (process.env["ORWELL_EMBEDDINGS"] ?? "").trim().toLowerCase();
// G1: the embeddings-provider status surfaced on /health (the admin Health & Logs card).
// `provider` is the EFFECTIVE provider right now; `degraded` is true when fastembed was
// requested but the process is (or has fallen) on the deterministic fallback — either a
// warm-up failure at boot or a mid-process worker death (FastembedEmbedding.degraded).
let embeddingsStatus: () => { provider: string; degraded: boolean } = () => ({
  provider: "deterministic",
  degraded: false,
});
if (embedMode === "fastembed") {
  const dataDir =
    process.env["ORWELL_DATA_DIR"] ?? process.env["BBAI_DATA_DIR"] ?? "./.orwell-data";
  const cacheDir = process.env["ORWELL_EMBED_CACHE"] || `${dataDir.replace(/\/$/, "")}/models`;
  // BOOT-SAFETY (prod incident 2026-06-19): the warm-up must NEVER wedge the engine. It runs
  // BEFORE startHttpMcp, and the catch below only handles a *thrown* error — a model download that
  // STALLS (cold cache + a blocked/slow model CDN) would hang this await forever, so the process
  // stays "active" under systemd yet never binds :8765 and /health never answers (exactly the
  // outage seen). Bound it: if the model isn't ready in time, fall back to the deterministic
  // embedder and boot anyway. Prefetch (`node dist/embedWorker.js --prefetch`) to keep real recall.
  const warmupMs = Number(process.env["ORWELL_EMBED_WARMUP_MS"]) || 45000;
  try {
    const { createFastembedEmbedding } = await import("./adapters/embedding/FastembedEmbedding");
    const provider = await Promise.race([
      createFastembedEmbedding({
        workerUrl: new URL("./embedWorker.js", import.meta.url),
        cacheDir,
      }),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error(`fastembed warm-up exceeded ${warmupMs}ms — booting on deterministic recall`)),
          warmupMs,
        );
        // Don't let the timeout itself keep the process alive once warm-up wins the race.
        if (typeof t.unref === "function") t.unref();
      }),
    ]);
    const { setRuntimeEmbedding } = await import("./composition/engineRoot");
    setRuntimeEmbedding(provider);
    embeddingsStatus = () =>
      provider.degraded
        ? { provider: "deterministic", degraded: true } // worker died mid-process — permanent for this run
        : { provider: "fastembed", degraded: false };
    console.log(`[orwell] semantic recall: fastembed (local ONNX, dim=${provider.dim}, cache=${cacheDir})`);
  } catch (e) {
    embeddingsStatus = () => ({ provider: "deterministic", degraded: true }); // requested but unavailable
    console.error(
      `[orwell] fastembed warm-up failed (${e instanceof Error ? e.message : String(e)}); ` +
        `semantic recall uses deterministic embeddings this run. ` +
        `Prefetch the model (node dist/embedWorker.js --prefetch --cache-dir ${cacheDir}) and restart to upgrade.`,
    );
  }
}

const runtime = composeRuntime({ durable: true });

// Network-edge guardrails (audit E1 / B34). Default to a trusted-loopback single-tenant deploy;
// any of these can be turned on for an exposed / multi-user deployment:
//   ORWELL_ENGINE_HOST      bind address (default 127.0.0.1 — loopback, matching docs/INSTALL.md)
//   ORWELL_ENGINE_TOKEN     shared secret required on every tool route (401 on mismatch)
//   ORWELL_ENGINE_ADMIN_TOKEN  SEPARATE secret demanded on /admin/* (audit E27) — the player
//                           token must not grant God Mode; admin's accepted on player routes
//   ORWELL_ENGINE_MULTIUSER reject a missing x-orwell-user header (400) instead of routing to "default"
const host = process.env["ORWELL_ENGINE_HOST"] ?? process.env["BBAI_ENGINE_HOST"] ?? "127.0.0.1";
const token = process.env["ORWELL_ENGINE_TOKEN"] || process.env["BBAI_ENGINE_TOKEN"] || undefined;
const adminToken = process.env["ORWELL_ENGINE_ADMIN_TOKEN"] || undefined;
const requireUser = /^(1|true|yes|on)$/i.test(process.env["ORWELL_ENGINE_MULTIUSER"] ?? "");
// A user is "known" once they have a live sandbox or a durable save — so an anonymous caller can't
// spray ids to mint unlimited sandboxes (only createCharacter may start a fresh one).
const knownUser = (user: string): boolean => runtime.knownUser(user);

runtime.start();
startHttpMcp({ resolve: runtime.registry.resolver() }, port, { token, adminToken, requireUser, knownUser, embeddingsStatus }, host);
// Tear the watcher down cleanly on shutdown (its interval is unref'd, so this is belt-and-suspenders).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    runtime.stop();
    process.exit(0);
  });
}
// eslint-disable-next-line no-console
console.log(`Orwell engine MCP server listening on http://${host}:${port}`);
