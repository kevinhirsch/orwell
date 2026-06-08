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

export interface EngineCommands {
  recordInteraction(req: RecordInteractionReq): { eventId: string };
  /** Outcome only — no stat scores, rankings, or Vault-derived reasoning. */
  resolveCompetition(req: ResolveCompetitionReq): { winner: EntityId; type: string };
  surfaceInformationTo(req: SurfaceReq): { ok: true };
}
