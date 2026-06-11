/**
 * ENGINE-ONLY fastembed worker (ADR 0004 / audit E86a). Runs the pinned fastembed
 * (local ONNX, BGE-small-en-v1.5) off the main thread and serves SYNCHRONOUS embed
 * calls to `FastembedEmbedding` over a SharedArrayBuffer + Atomics protocol — the
 * engine's soul/recall seam is synchronous by design (an `await` inside a mutating
 * tool would reopen the sandbox-swap race the sync contract masks).
 *
 * Protocol (one in-flight request at a time — the main thread blocks):
 *   shared memory = Int32Array ctl[2] | Float64Array payload
 *     ctl[0] state: 0 = pending, 1 = ok (payload holds the vector), 2 = error
 *     ctl[1] vector length (floats)
 *   main: ctl[0]=0 → postMessage({ text }) → Atomics.wait(ctl, 0, 0, timeout)
 *   worker: embed → write payload + ctl[1] → Atomics.store(ctl[0], 1|2) → notify
 *
 * Doubles as the deploy-time prefetch CLI (offline-friendly thereafter — ADR 0004):
 *   node dist/embedWorker.js --prefetch [--cache-dir <dir>] [--model <name>]
 */
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdirSync } from "node:fs";

// The PIN (ADR 0004): library version is exact in package.json; the model is pinned
// here — changing either is a deliberate, versioned recall migration, never drift.
export const PINNED_MODEL = "fast-bge-small-en-v1.5";

type Embedder = { passageEmbed(texts: string[], batchSize?: number): AsyncGenerator<number[][], void, unknown> };

async function initEmbedder(cacheDir: string, model: string): Promise<Embedder> {
  mkdirSync(cacheDir, { recursive: true });
  const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
  // Resolve the pinned model NAME to the enum member (the init overloads demand the
  // concrete non-custom member, not the enum type).
  const entry = Object.entries(EmbeddingModel).find(([, v]) => v === model && v !== EmbeddingModel.CUSTOM);
  if (!entry) throw new Error(`unknown fastembed model "${model}" (pinned: ${PINNED_MODEL})`);
  return FlagEmbedding.init({
    model: EmbeddingModel[entry[0] as keyof typeof EmbeddingModel] as Exclude<
      (typeof EmbeddingModel)[keyof typeof EmbeddingModel],
      typeof EmbeddingModel.CUSTOM
    >,
    cacheDir,
    showDownloadProgress: false,
  });
}

async function embedOne(embedder: Embedder, text: string): Promise<number[]> {
  // One symmetric space for stores AND queries (BGE v1.5 is prefix-free-friendly);
  // SoulStore uses a single embed fn for both, so symmetry is the correct choice.
  for await (const batch of embedder.passageEmbed([text.length > 0 ? text : " "], 1)) {
    const vec = batch[0];
    if (vec) return Array.from(vec as ArrayLike<number>);
  }
  throw new Error("fastembed returned no vector");
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  const { sab, cacheDir, model } = workerData as { sab: SharedArrayBuffer; cacheDir: string; model: string };
  const ctl = new Int32Array(sab, 0, 2);
  const payload = new Float64Array(sab, 8);

  void (async () => {
    try {
      const embedder = await initEmbedder(cacheDir, model ?? PINNED_MODEL);
      const probe = await embedOne(embedder, "warm-up probe");
      port.postMessage({ type: "ready", dim: probe.length });
      port.on("message", (msg: { text: string }) => {
        void (async () => {
          try {
            const vec = await embedOne(embedder, msg.text);
            if (vec.length > payload.length) throw new Error(`vector dim ${vec.length} exceeds shared buffer`);
            payload.set(vec);
            ctl[1] = vec.length;
            Atomics.store(ctl, 0, 1);
          } catch (e) {
            console.error(`[orwell] fastembed worker embed failed: ${e instanceof Error ? e.message : String(e)}`);
            Atomics.store(ctl, 0, 2);
          }
          Atomics.notify(ctl, 0);
        })();
      });
    } catch (e) {
      port.postMessage({ type: "init-error", error: e instanceof Error ? e.message : String(e) });
    }
  })();
} else if (isMainThread && process.argv.includes("--prefetch")) {
  // Deploy-time model fetch/cache (orwell-install.sh / orwell-update.sh): downloads the
  // pinned model into the cache dir so engine boots are offline + fast thereafter.
  const argOf = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const cacheDir = argOf("--cache-dir") ?? `${process.cwd()}/.orwell-data/models`;
  const model = argOf("--model") ?? PINNED_MODEL;
  void (async () => {
    try {
      const embedder = await initEmbedder(cacheDir, model);
      await embedOne(embedder, "prefetch probe");
      console.log(`[orwell] fastembed model "${model}" cached at ${cacheDir}`);
      process.exit(0);
    } catch (e) {
      console.error(`[orwell] fastembed prefetch failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  })();
}
