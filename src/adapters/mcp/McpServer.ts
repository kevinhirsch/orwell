import { toolsFor } from "../../surfaces/tools/registry";
import { EngineRefusal } from "../../domain/errors";
import type { OutwardChannel, ToolDescriptor } from "../../surfaces/tools/registry";
import type { PlayerSurface } from "../../surfaces/player/PlayerSurface";
import type { AdminPort } from "../../surfaces/admin/AdminPort";
import type { SummaryService } from "../../services/SummaryService";
import type { EngineCommands, RecordInteractionReq, SurfaceReq, DiaryRoomReq } from "../../ports/EngineCommands";
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

/**
 * Per-tool argument shape checks (audit E31/D10/R6): malformed args used to cast blindly into the
 * adapters and die as 500 "internal error"s deep inside the engine (R6's live repro: a STRING
 * `witnessSet` was iterated char-by-char — "non-living houseguest: p"). Each check throws a
 * DELIBERATE `EngineRefusal` naming the offending field, which the HTTP edge maps to a 400.
 * Checks are minimal required-field/shape guards — the engine's own domain validation (legality,
 * liveness) stays where it is.
 */
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function requireShape(name: string, args: Record<string, unknown>): void {
  const refuse = (field: string, want: string): never => {
    throw new EngineRefusal(`invalid args for ${name}: "${field}" must be ${want}`);
  };
  // 0065 — shape-guard the OPTIONAL sync-spine fields the SAME way E31/D10/R6 guards every other
  // optional arg (a malformed value would otherwise cast blindly into the adapter): `expectedBeatSeq`
  // must be a number when present (the CAS token, Part A); `idempotencyKey` a string when present
  // (the at-most-once retry key, Part B). Absent ⇒ unchanged (fully opt-in).
  const guardSyncFields = (allowIdempotency: boolean): void => {
    if (args["expectedBeatSeq"] !== undefined && typeof args["expectedBeatSeq"] !== "number") {
      refuse("expectedBeatSeq", "a number when present");
    }
    if (allowIdempotency && args["idempotencyKey"] !== undefined && typeof args["idempotencyKey"] !== "string") {
      refuse("idempotencyKey", "a string when present");
    }
  };
  switch (name) {
    case "recordInteraction":
      guardSyncFields(false); // 0065 Part A — optional expectedBeatSeq (no idempotency key here)
      if (!isStr(args["initiator"])) refuse("initiator", "a houseguest id (string)");
      if (!isStrArray(args["witnessSet"])) refuse("witnessSet", "an array of houseguest ids");
      if (!isStr(args["content"])) refuse("content", "a non-empty string");
      if (args["kind"] !== undefined && typeof args["kind"] !== "string") refuse("kind", "a string when present");
      if (args["toward"] !== undefined && !isStrArray(args["toward"])) refuse("toward", "an array of houseguest ids when present");
      // 0005: the optional generative-consequence descriptor. Shape-guard only (R6 class: a string
      // where an array/object is expected dies deep in the fold) — the engine owns the magnitude and
      // degrades gracefully on an unknown direction, so domain validation stays there, not here.
      if (args["consequence"] !== undefined) {
        const c = args["consequence"];
        if (typeof c !== "object" || c === null || Array.isArray(c)) refuse("consequence", "an object when present");
        const cons = c as Record<string, unknown>;
        if (cons["edges"] !== undefined) {
          if (!Array.isArray(cons["edges"])) refuse("consequence.edges", "an array when present");
          for (const e of cons["edges"] as unknown[]) {
            if (typeof e !== "object" || e === null || Array.isArray(e)) refuse("consequence.edges[]", "objects with a toward + direction");
            const edge = e as Record<string, unknown>;
            if (!isStr(edge["toward"])) refuse("consequence.edges[].toward", "a houseguest id (string)");
            if (!isStr(edge["direction"])) refuse("consequence.edges[].direction", "a direction (string)");
            if (edge["emphasis"] !== undefined && typeof edge["emphasis"] !== "string") refuse("consequence.edges[].emphasis", "a string when present");
          }
        }
        if (cons["rationale"] !== undefined && typeof cons["rationale"] !== "string") refuse("consequence.rationale", "a string when present");
      }
      return;
    case "surfaceInformationTo": {
      guardSyncFields(false); // 0065 Part A — optional expectedBeatSeq
      if (!isStr(args["entity"])) refuse("entity", "an entity id (string)");
      const fact = args["fact"];
      if (typeof fact !== "object" || fact === null || !isStr((fact as Record<string, unknown>)["content"])) {
        refuse("fact.content", "a non-empty string");
      }
      if (!isStr(args["pathway"])) refuse("pathway", "a pathway string");
      return;
    }
    case "diaryRoom":
      if (!isStr(args["entry"])) refuse("entry", "a non-empty string");
      return;
    case "advanceGame":
      guardSyncFields(true); // 0065 Parts A+B — optional expectedBeatSeq + idempotencyKey
      return;
    case "submitDecision":
      guardSyncFields(true); // 0065 Parts A+B — optional expectedBeatSeq + idempotencyKey
      if (!isStr(args["kind"])) refuse("kind", "a decision kind (string)");
      if (args["choice"] !== undefined && !isStrArray(args["choice"])) refuse("choice", "an array of houseguest ids when present");
      return;
    case "moveTo":
      guardSyncFields(false); // 0065 Part A — optional expectedBeatSeq
      return;
    case "makeDeal":
      guardSyncFields(false); // 0065 Part A — optional expectedBeatSeq
      if (!isStr(args["with"])) refuse("with", "a houseguest id (string)");
      if (!isStr(args["kind"])) refuse("kind", "a deal kind (string)");
      if (!isStr(args["terms"])) refuse("terms", "a non-empty string");
      return;
    case "runCompetition":
      if (args["type"] !== undefined && typeof args["type"] !== "string") refuse("type", "a string when present");
      if (args["participantIds"] !== undefined && !isStrArray(args["participantIds"])) {
        refuse("participantIds", "an array of houseguest ids when present");
      }
      return;
    case "npcVoice":
    case "getPortraitPrompt":
    case "markHouseguestMet": // PREMIERE meet-everyone (#380) — takes a houseguest id
      if (!isStr(args["id"])) refuse("id", "a houseguest id (string)");
      return;
    case "recordImageBeat":
      if (!isStr(args["houseguestId"])) refuse("houseguestId", "a houseguest id (string)");
      if (!isStr(args["imageRef"])) refuse("imageRef", "a non-empty string");
      return;
    default:
      return; // read tools and free-text tools take no required structure
  }
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
    requireShape(name, args); // E31: deliberate 400s with field names, never a 500 from a blind cast
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
        // 0065 — optional expectedBeatSeq (CAS) + idempotencyKey (at-most-once) ride the args.
        return this.deps.session.advanceGame(args as { expectedBeatSeq?: number; idempotencyKey?: string });
      case "submitDecision":
        return this.deps.session.submitDecision(args as unknown as SubmitDecisionReq);
      case "requestSelfEviction":
        // 0061 step 1: raise the OOC self-evict confirmation (no state change; the house never hears it).
        return this.deps.session.requestSelfEviction();
      case "cancelSelfEviction":
        // 0061: decline the confirmation — the player plays on, ACTIVE and unchanged.
        return this.deps.session.cancelSelfEviction();
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
      case "moveTo":
        // 0065 Part A — optional expectedBeatSeq CAS token rides the args.
        return this.deps.session.movePlayer(
          String(args["room"] ?? ""),
          typeof args["expectedBeatSeq"] === "number" ? args["expectedBeatSeq"] : undefined,
        );
      // PREMIERE meet-everyone (feature #380 follow-on): read who's still to introduce / mark a meeting.
      case "premiereIntros":
        return this.deps.session.premiereIntros();
      case "markHouseguestMet":
        return this.deps.session.markHouseguestMet(args["id"] as EntityId);
      case "seasonRecap":
        return this.deps.session.seasonRecap();
      case "seasonRetrospective":
        return this.deps.session.seasonRetrospective();
      case "npcVoice":
        return this.deps.session.npcVoice(args["id"] as EntityId);
      case "getPortraitPrompt":
        return this.deps.session.getPortraitPrompt(args["id"] as EntityId);
      case "askProducers":
        return this.deps.player.ask(String(args["question"] ?? ""));
      case "endOfSessionSummary":
        return this.deps.summary.endOfSession();
      case "recordInteraction":
        return this.deps.commands.recordInteraction(args as unknown as RecordInteractionReq);
      // E20: no "resolveCompetition" case — it is off the allowlist, so `allows()` refuses it
      // before dispatch; runCompetition (the live-house session resolver) is the one authority.
      case "surfaceInformationTo":
        return this.deps.commands.surfaceInformationTo(args as unknown as SurfaceReq);
      case "diaryRoom":
        return this.deps.commands.diaryRoom(args as unknown as DiaryRoomReq);
      case "recordImageBeat":
        return this.deps.commands.recordImageBeat(
          args as unknown as { houseguestId: string; imageRef: string },
        );
      case "inspectNonVaultState":
        return this.deps.admin.inspect();
      case "overrideMechanic":
        return this.deps.admin.overrideMechanic(args as unknown as { mechanic: string; value: unknown });
      case "configure":
        return this.deps.admin.configure(args as Record<string, unknown>);
      case "manageSandbox":
        return this.deps.admin.manageSandbox(args["op"] as "create" | "reset" | "save" | "load" | undefined);
      case "sandboxHealth":
        return this.deps.admin.health();
      case "advanceToFinale":
        // L38 (admin/God-Mode only — gated by `allows()` above): drive the season to a crowned
        // winner so the post-season retrospective can unseal. Vault-free summary out; reads no Vault.
        return this.deps.admin.advanceToFinale();
      default:
        throw new Error(`unhandled tool "${name}"`);
    }
  }
}
