import { toolsFor } from "../../surfaces/tools/registry";
import type { OutwardChannel, ToolDescriptor } from "../../surfaces/tools/registry";
import type { PlayerSurface } from "../../surfaces/player/PlayerSurface";
import type { AdminPort } from "../../surfaces/admin/AdminPort";
import type { SummaryService } from "../../services/SummaryService";
import type { EngineCommands, RecordInteractionReq, ResolveCompetitionReq, SurfaceReq, DiaryRoomReq } from "../../ports/EngineCommands";
import type { EntityId } from "../../domain/ids";
import type { GameSession, CreateCharacterReq, UpdateCastingReq, MomentPromptReq, RunCompetitionReq, SubmitDecisionReq, MakeDealReq } from "../../ports/GameSession";

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
      case "updateCasting":
        return this.deps.session.updateCasting(args as unknown as UpdateCastingReq);
      case "getGameState":
        return this.deps.session.getGameState();
      case "gameStatus":
        return this.deps.session.gameStatus();
      case "playerTagline":
        return this.deps.session.playerTagline();
      case "finaleView":
        return this.deps.session.finaleView();
      case "getMomentPrompt":
        return this.deps.session.getMomentPrompt(args as unknown as MomentPromptReq);
      case "runCompetition":
        return this.deps.session.runCompetition(args as unknown as RunCompetitionReq);
      case "advanceGame":
        return this.deps.session.advanceGame();
      case "submitDecision":
        return this.deps.session.submitDecision(args as unknown as SubmitDecisionReq);
      case "makeDeal":
        return this.deps.session.makeDeal(args as unknown as MakeDealReq);
      case "getVisibleStateFor":
        return this.deps.player.getVisibleState();
      case "renderScene":
        return this.deps.player.produce(args["mode"] === "dialogue" ? "NPC dialogue" : "scene narration");
      case "socialRead":
        return this.deps.player.socialRead(args["target"] as EntityId | undefined);
      case "socialInitiatives":
        return this.deps.session.socialInitiatives();
      case "whereabouts":
        return this.deps.session.whereabouts();
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
      case "diaryRoom":
        return this.deps.commands.diaryRoom(args as unknown as DiaryRoomReq);
      case "inspectNonVaultState":
        return this.deps.admin.inspect();
      case "overrideMechanic":
        return this.deps.admin.overrideMechanic(args as unknown as { mechanic: string; value: unknown });
      case "configure":
        return this.deps.admin.configure(args as Record<string, unknown>);
      case "manageSandbox":
        return this.deps.admin.manageSandbox(args["op"] as "create" | "reset" | "save" | "load" | undefined);
      default:
        throw new Error(`unhandled tool "${name}"`);
    }
  }
}
