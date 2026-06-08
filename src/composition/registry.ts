import { buildEngineCore } from "./engineRoot";
import type { EngineCore } from "./engineRoot";
import { buildOutwardChannels } from "./outwardRoot";
import { InMemoryGameStateRepository } from "../adapters/inmemory/InMemoryGameStateRepository";
import { EngineCommandsAdapter } from "../adapters/engine/EngineCommandsAdapter";
import { GameSessionAdapter } from "../adapters/engine/GameSessionAdapter";
import { McpServer } from "../adapters/mcp/McpServer";
import { PLAYER } from "../domain/ids";
import type { PlayerSurface } from "../surfaces/player/PlayerSurface";
import type { AdminPort } from "../surfaces/admin/AdminPort";
import type { SummaryService } from "../services/SummaryService";

/**
 * Per-user game sandboxes (feature 0021). Each authenticated user gets ONE active
 * game in a fully isolated sandbox — its own engine core (events, Vault, knowledge,
 * relationships), GameSession, outward surfaces, and MCP servers. Many users run
 * at once, each a separate object graph, so NO call on behalf of user A can ever
 * reach user B's state. This is a second isolation axis, orthogonal to the Vault
 * Wall (which still holds inside every sandbox).
 *
 * Lives in the composition layer (it wires the engine root, which holds the Vault);
 * the outward HTTP transport never imports this — it receives a Vault-free resolver.
 */
export interface UserSandbox {
  engine: EngineCore;
  player: PlayerSurface;
  admin: AdminPort;
  summary: SummaryService;
  session: GameSessionAdapter;
  mcp: { player: McpServer; admin: McpServer };
}

function buildUserSandbox(): UserSandbox {
  const engine = buildEngineCore();
  const adminState = new InMemoryGameStateRepository({ week: 1, phase: "setup", houseguests: [] });
  const outward = buildOutwardChannels({
    player: PLAYER, events: engine.events, knowledge: engine.knowledge, adminState,
  });
  const commands = new EngineCommandsAdapter(engine.events, engine.knowledge, engine.relationships);
  const session = new GameSessionAdapter();
  const deps = { player: outward.player, admin: outward.admin, summary: outward.summary, commands, session };
  return {
    engine,
    player: outward.player,
    admin: outward.admin,
    summary: outward.summary,
    session,
    mcp: { player: new McpServer("player", deps), admin: new McpServer("admin/God Mode", deps) },
  };
}

export class GameSessionRegistry {
  private readonly sandboxes = new Map<string, UserSandbox>();

  /** The user's isolated sandbox — created on first use, resumed on return. */
  sandboxFor(user: string): UserSandbox {
    let sb = this.sandboxes.get(user);
    if (!sb) {
      sb = buildUserSandbox();
      this.sandboxes.set(user, sb);
    }
    return sb;
  }

  /** Number of distinct user sandboxes currently held (concurrency visibility). */
  userCount(): number {
    return this.sandboxes.size;
  }

  /** Start a fresh game for the user — replaces ONLY their own sandbox (others untouched). */
  resetUser(user: string): UserSandbox {
    const sb = buildUserSandbox();
    this.sandboxes.set(user, sb);
    return sb;
  }

  /** A Vault-free channel resolver for the HTTP transport (keeps the outward layer Vault-free). */
  resolver(): (channel: "player" | "admin", user: string) => McpServer {
    return (channel, user) => {
      const sb = this.sandboxFor(user);
      return channel === "player" ? sb.mcp.player : sb.mcp.admin;
    };
  }
}
