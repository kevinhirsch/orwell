import { buildEngineCore } from "./engineRoot";
import { buildOutwardChannels } from "./outwardRoot";
import { InMemoryGameStateRepository } from "../adapters/inmemory/InMemoryGameStateRepository";
import { EngineCommandsAdapter } from "../adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../adapters/mcp/McpServer";
import { PLAYER } from "../domain/ids";

/**
 * The application composition root — wires the engine (which holds the Vault) AND
 * the outward MCP servers, handing the outward side only the non-Vault ports.
 * This is the one place allowed to touch both sides; the MCP servers it returns
 * have no Vault handle. (In-memory adapters for now; SQLite/Postgres later.)
 */
export interface McpServers {
  player: McpServer;
  admin: McpServer;
}

export function buildMcpServers(): McpServers {
  const engine = buildEngineCore();
  const adminState = new InMemoryGameStateRepository({ week: 1, phase: "setup", houseguests: [] });
  const outward = buildOutwardChannels({
    player: PLAYER, events: engine.events, knowledge: engine.knowledge, adminState,
  });
  const commands = new EngineCommandsAdapter(engine.events, engine.knowledge);
  const deps = { player: outward.player, admin: outward.admin, summary: outward.summary, commands };
  return { player: new McpServer("player", deps), admin: new McpServer("admin/God Mode", deps) };
}
