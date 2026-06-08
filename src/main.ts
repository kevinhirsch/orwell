import { buildMcpServers } from "./composition/appRoot";
import { startHttpMcp } from "./adapters/mcp/HttpMcpServer";

/**
 * The `bbai-engine` entrypoint (feature 0010's `npm run build` / `npm start`
 * target). Brings up the permissioned MCP server over HTTP; the odysseus
 * front-end connects to it via `BBAI_ENGINE_MCP_URL`. Port comes from the
 * environment (no secrets here) — `BBAI_ENGINE_PORT` is the documented engine
 * port (8765, per docs/INSTALL.md); `BBAI_PORT` is kept as a legacy fallback.
 */
const port = Number(process.env["BBAI_ENGINE_PORT"] ?? process.env["BBAI_PORT"] ?? 8765);
startHttpMcp(buildMcpServers(), port);
// eslint-disable-next-line no-console
console.log(`bbai engine MCP server listening on http://0.0.0.0:${port}`);
