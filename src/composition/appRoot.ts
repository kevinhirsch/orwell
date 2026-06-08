import { GameSessionRegistry } from "./registry";
import type { McpServer } from "../adapters/mcp/McpServer";

/**
 * The application composition root. Per-user sandboxes (0021) are the model now —
 * a `GameSessionRegistry` keys an isolated game per user. `buildMcpServers()`
 * returns the MCP servers for a single default sandbox (used by the in-process
 * integration test and any single-tenant caller); the HTTP entrypoint (`main.ts`)
 * uses a long-lived registry + its Vault-free resolver to route per user.
 */
export interface McpServers {
  player: McpServer;
  admin: McpServer;
}

export function buildMcpServers(user = "default"): McpServers {
  return new GameSessionRegistry().sandboxFor(user).mcp;
}
