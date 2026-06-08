import { buildMcpServers } from "./composition/appRoot";
import { startHttpMcp } from "./adapters/mcp/HttpMcpServer";

/**
 * The `bbai-engine` entrypoint (feature 0010's `npm run build` / `npm start`
 * target). Brings up the permissioned MCP server over HTTP; the odysseus
 * front-end connects to it. Port comes from the environment (no secrets here).
 */
// BBAI_ENGINE_PORT is the engine's own listen port (set by deploy; loopback to the frontend).
// Falls back to BBAI_PORT for single-service dev usage, then to 8848.
const port = Number(process.env["BBAI_ENGINE_PORT"] ?? process.env["BBAI_PORT"] ?? 8848);
startHttpMcp(buildMcpServers(), port);
// eslint-disable-next-line no-console
console.log(`bbai engine MCP server listening on http://0.0.0.0:${port}`);
