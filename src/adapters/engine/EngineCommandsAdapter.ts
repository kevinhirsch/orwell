import type {
  EngineCommands, RecordInteractionReq, ResolveCompetitionReq, SurfaceReq,
} from "../../ports/EngineCommands";
import type { EventStore } from "../../ports/EventStore";
import type { KnowledgeService } from "../../ports/KnowledgeService";
import type { EntityId } from "../../domain/ids";
import { PLAYER } from "../../domain/ids";
import { resolveCompetition, CompetitionIntents } from "../../domain/competitionOutcome";
import { SeededRandom } from "../random/SeededRandom";

/**
 * Engine-side implementation of the Vault-free command port. It may touch the
 * core to decide (e.g. weigh stats inside `resolveCompetition`) but returns only
 * Vault-free results. This lives on the ENGINE side; the MCP server depends on
 * the `EngineCommands` interface, not on this class.
 */
export class EngineCommandsAdapter implements EngineCommands {
  private seq = 0;

  constructor(
    private readonly events: EventStore,
    private readonly knowledge: KnowledgeService,
  ) {}

  recordInteraction(req: RecordInteractionReq): { eventId: string } {
    const eventId = `evt:mcp:${++this.seq}`;
    this.events.record({
      id: eventId, ts: this.seq, type: "conversation",
      initiator: req.initiator, witnessSet: req.witnessSet,
      hidden: !req.witnessSet.includes(PLAYER), content: req.content,
    });
    return { eventId };
  }

  resolveCompetition(req: ResolveCompetitionReq): { winner: EntityId; type: string } {
    const intents = new CompetitionIntents();
    for (const it of req.intents ?? []) intents.declare(it.id, it.intent);
    const result = resolveCompetition(req.participants, req.type, intents, new SeededRandom(req.seed));
    return { winner: result.winner, type: req.type }; // outcome only — scores stay engine-internal
  }

  surfaceInformationTo(req: SurfaceReq): { ok: true } {
    this.knowledge.surfaceInformationTo(req.entity, req.fact, req.pathway);
    return { ok: true };
  }
}
