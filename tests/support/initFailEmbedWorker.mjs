// Test stand-in: fails warm-up — exercises the createFastembedEmbedding rejection path
// (main.ts then composes the deterministic provider for the whole process).
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ type: "init-error", error: "no model in this environment (test)" });
