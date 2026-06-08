import { buildMcpServers } from "./composition/appRoot";
import { startHttpMcp } from "./adapters/mcp/HttpMcpServer";

/**
 * target). Brings up the permissioned MCP server over HTTP; the Orwell
 * front-end connects to it via `BBAI_ENGINE_MCP_URL`. Port comes from the
 * environment (no secrets here) — `BBAI_ENGINE_PORT` is the documented engine
 * port (8765, per docs/INSTALL.md); `BBAI_PORT` is kept as a legacy fallback.
 */
// parseInt + trim guards against stray whitespace or inline-comment fragments that some
// systemd EnvironmentFile parsers pass through (a real crash we hit: Number("8765 # ...") → NaN).
function parsePort(raw: string | undefined, fallback: number): number {
  const n = parseInt((raw ?? "").trim(), 10);
  return n > 0 && n < 65536 ? n : fallback;
}
const port = parsePort(process.env["BBAI_ENGINE_PORT"] ?? process.env["BBAI_PORT"], 8765);
startHttpMcp(buildMcpServers(), port);
// eslint-disable-next-line no-console
console.log(`bbai engine MCP server listening on http://0.0.0.0:${port}`);
