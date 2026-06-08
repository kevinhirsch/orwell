import { GameSessionRegistry } from "./composition/registry";
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
// One long-lived registry: each authenticated user (asserted by the front-end over the
// x-orwell-user header) gets an isolated sandbox; calls route there (per-user model, 0021).
// A disk-backed save store (0030) makes each user's game survive an engine restart — saved on
// every mutation, recalled on resume — so the onboarding overlay never re-fires for a returning
// player. Data dir from ORWELL_DATA_DIR (BBAI_DATA_DIR legacy fallback).
const registry = new GameSessionRegistry(new FileSaveStore());
startHttpMcp({ resolve: registry.resolver() }, port);
// eslint-disable-next-line no-console
console.log(`Orwell engine MCP server listening on http://0.0.0.0:${port}`);
