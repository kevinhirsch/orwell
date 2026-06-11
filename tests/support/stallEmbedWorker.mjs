// Test stand-in: reports ready, then never answers an embed — exercises the
// FastembedEmbedding timeout → permanent-degrade → deterministic-fallback path.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ type: "ready", dim: 8 });
parentPort.on("message", () => {
  /* deliberately never responds */
});
