import type { EntityId } from "../domain/ids";
import type { Competitor, CompetitionType, Intent } from "../domain/competitionOutcome";

/**
 * Vault-free command port (0009). Action tools cross the membrane through THIS
 * interface: the engine performs them (and may read the core/Vault internally to
 * decide), but every argument and return type here is Vault-free, so the outward
 * MCP server depends on this — never on the engine root or `VaultStore`.
 */
export interface RecordInteractionReq {
  initiator: EntityId;
  witnessSet: EntityId[];
  content: string;
  /**
   * Optional interaction nature (caller/LLM-PROPOSED): "bonding" | "betrayal" | "conflict" |
   * "strategy" | "alliance" | "gossip" | "showmance". When present, the engine folds the HIDDEN
   * relationship impact into the layer (0017/0023) — the magnitude is the engine's (anti-sycophancy).
   */
  kind?: string;
  /** Whose hidden opinion of the initiator moves (default: the other witnesses). */
  toward?: EntityId[];
}

export interface ResolveCompetitionReq {
  type: CompetitionType;
  participants: Competitor[];
  intents?: Array<{ id: EntityId; intent: Intent }>;
  seed: number;
}

export interface SurfaceReq {
  entity: EntityId;
  fact: { content: string };
  pathway: string;
}

export interface DiaryRoomReq {
  /** The player's out-of-character confessional entry. */
  entry: string;
}

export interface EngineCommands {
  /** Records the interaction + folds its hidden impact. Throws if it names a non-living houseguest (B39). */
  recordInteraction(req: RecordInteractionReq): { eventId: string };
  /** Outcome only — no stat scores, rankings, or Vault-derived reasoning. */
  resolveCompetition(req: ResolveCompetitionReq): { winner: EntityId; type: string };
  /** `surfaced:true` if anchored into knowledge; `false` if the pathway was unanchored ⇒ a suspicion (A4). */
  surfaceInformationTo(req: SurfaceReq): { ok: true; surfaced: boolean };
  /**
   * Record a player Diary-Room entry (0013): the player's OWN out-of-character knowledge,
   * tagged with NO in-game pathway to any NPC. It may inform the engine's read of player
   * strategy but NEVER reaches NPC behavior — no houseguest can ever learn it.
   */
  diaryRoom(req: DiaryRoomReq): { recorded: true };
}
