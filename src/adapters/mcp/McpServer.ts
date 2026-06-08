import { toolsFor } from "../../surfaces/tools/registry";
import type { OutwardChannel, ToolDescriptor } from "../../surfaces/tools/registry";
import type { PlayerSurface } from "../../surfaces/player/PlayerSurface";
import type { AdminPort } from "../../surfaces/admin/AdminPort";
import type { SummaryService } from "../../services/SummaryService";
import type { EngineCommands, RecordInteractionReq, ResolveCompetitionReq, SurfaceReq } from "../../ports/EngineCommands";
import type { GameSession, CreateCharacterReq, MomentPromptReq } from "../../ports/GameSession";

/**
 * The engine's permissioned outward MCP API (0009). It mounts ONLY the
 * allowlisted tools for its channel, sources read/narrate tools from the visible
 * projection, and reaches the engine for action tools solely through the
 * Vault-free `EngineCommands` port. It imports no Vault types, no vector index,
 * and no engine root — verified by dependency-cruiser. The concrete stdio/HTTP
 * MCP transport is a thin shell over this router (deferred); calls are async so a
 * live (async) LLM narrator slots in without changing the boundary.
 */
export interface McpDeps {
  player: PlayerSurface;
  admin: AdminPort;
  summary: SummaryService;
  commands: EngineCommands;
  session: GameSession;
}

export class McpServer {
  constructor(private readonly channel: OutwardChannel, private readonly deps: McpDeps) {}

  listTools(): readonly ToolDescriptor[] {
    return toolsFor(this.channel);
  }

  private allows(name: string): boolean {
    return this.listTools().some((t) => t.name === name);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.allows(name)) {
      throw new Error(`tool "${name}" is not available on channel "${this.channel}"`);
    }
    switch (name) {
      case "createCharacter":
        return this.deps.session.createCharacter(args as unknown as CreateCharacterReq);
      case "getGameState":
        return this.deps.session.getGameState();
      case "getMomentPrompt":
        return this.deps.session.getMomentPrompt(args as unknown as MomentPromptReq);
      case "getVisibleStateFor":
        return this.deps.player.getVisibleState();
      case "renderScene":
        return this.deps.player.produce(args["mode"] === "dialogue" ? "NPC dialogue" : "scene narration");
      case "askProducers":
        return this.deps.player.ask(String(args["question"] ?? ""));
      case "endOfSessionSummary":
        return this.deps.summary.endOfSession();
      case "recordInteraction":
        return this.deps.commands.recordInteraction(args as unknown as RecordInteractionReq);
      case "resolveCompetition":
        return this.deps.commands.resolveCompetition(args as unknown as ResolveCompetitionReq);
      case "surfaceInformationTo":
        return this.deps.commands.surfaceInformationTo(args as unknown as SurfaceReq);
      case "inspectNonVaultState":
        return this.deps.admin.inspect();
      case "overrideMechanic":
        return { ok: true };
      default:
        throw new Error(`unhandled tool "${name}"`);
    }
  }
}
