// Test stand-in for dist/embedWorker.js: speaks the exact FastembedEmbedding SAB protocol
// with a trivial deterministic 8-dim vector — proves the sync bridge without ONNX/network.
import { parentPort, workerData } from "node:worker_threads";

const { sab } = workerData;
const ctl = new Int32Array(sab, 0, 2);
const payload = new Float64Array(sab, 8);
const DIM = 8;

parentPort.postMessage({ type: "ready", dim: DIM });
parentPort.on("message", ({ text }) => {
  const v = new Array(DIM).fill(0);
  for (let i = 0; i < text.length; i++) v[i % DIM] += text.charCodeAt(i);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  payload.set(v.map((x) => x / norm));
  ctl[1] = DIM;
  Atomics.store(ctl, 0, 1);
  Atomics.notify(ctl, 0);
});
