import { composeRuntime } from "./composition/runtime";
import { FileSaveStore } from "./adapters/engine/FileSaveStore";
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
// save store (0030) so a started game survives an engine restart — PLUS the background watcher
// (0031) behind a real-timer clock, so the house keeps scheming/drifting between player turns.
// Cadence comes from ORWELL_WATCHER_* env (ORWELL_WATCHER_TICK_MS=0 disables it → pure turn-driven);
// data dir from ORWELL_DATA_DIR (BBAI_DATA_DIR legacy fallback).
const saveStore = new FileSaveStore();
const runtime = composeRuntime({ saveStore });

// Network-edge guardrails (audit E1 / B34). Default to a trusted-loopback single-tenant deploy;
// any of these can be turned on for an exposed / multi-user deployment:
//   ORWELL_ENGINE_HOST      bind address (default 127.0.0.1 — loopback, matching docs/INSTALL.md)
//   ORWELL_ENGINE_TOKEN     shared secret required on every tool route (401 on mismatch)
//   ORWELL_ENGINE_MULTIUSER reject a missing x-orwell-user header (400) instead of routing to "default"
const host = process.env["ORWELL_ENGINE_HOST"] ?? process.env["BBAI_ENGINE_HOST"] ?? "127.0.0.1";
const token = process.env["ORWELL_ENGINE_TOKEN"] || process.env["BBAI_ENGINE_TOKEN"] || undefined;
const requireUser = /^(1|true|yes|on)$/i.test(process.env["ORWELL_ENGINE_MULTIUSER"] ?? "");
// A user is "known" once they have a live sandbox or a durable save — so an anonymous caller can't
// spray ids to mint unlimited sandboxes (only createCharacter may start a fresh one).
const knownUser = (user: string): boolean =>
  runtime.registry.usernames().includes(user) || saveStore.hasSave(user);

runtime.start();
startHttpMcp({ resolve: runtime.registry.resolver() }, port, { token, requireUser, knownUser }, host);
// Tear the watcher down cleanly on shutdown (its interval is unref'd, so this is belt-and-suspenders).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    runtime.stop();
    process.exit(0);
  });
}
// eslint-disable-next-line no-console
console.log(`Orwell engine MCP server listening on http://${host}:${port}`);
