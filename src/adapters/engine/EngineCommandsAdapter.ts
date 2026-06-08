import type {
  EngineCommands, RecordInteractionReq, ResolveCompetitionReq, SurfaceReq, DiaryRoomReq,
} from "../../ports/EngineCommands";
import type { EventStore } from "../../ports/EventStore";
import type { KnowledgeService } from "../../ports/KnowledgeService";
import type { RandomnessSource } from "../../ports/RandomnessSource";
import type { EntityId } from "../../domain/ids";
import { PLAYER } from "../../domain/ids";
import { resolveCompetition, CompetitionIntents } from "../../domain/competitionOutcome";
import { SeededRandom } from "../random/SeededRandom";
import type { RelationshipModel, InteractionType } from "../../engine/relationships";

const INTERACTION_KINDS: ReadonlySet<string> = new Set<InteractionType>([
  "alliance", "gossip", "conflict", "bonding", "strategy", "showmance", "betrayal",
]);

/**
 * Engine-side implementation of the Vault-free command port. It may touch the
 * core to decide (e.g. weigh stats inside `resolveCompetition`) but returns only
 * Vault-free results. This lives on the ENGINE side; the MCP server depends on
 * the `EngineCommands` interface, not on this class.
 *
 * With a relationship model wired in (0023), `recordInteraction` is no longer a
 * no-op log: a happening with a proposed `kind` folds its HIDDEN impact into the
 * layer (how the others feel about the initiator) — invisible to the player.
 */
export class EngineCommandsAdapter implements EngineCommands {
  private seq = 0;
  /** Save-on-mutation hook (0030); the registry wires it to persist the user's snapshot. */
  private onPersist?: () => void;

  constructor(
    private readonly events: EventStore,
    private readonly knowledge: KnowledgeService,
    private readonly rel?: RelationshipModel,
    private readonly rng: RandomnessSource = new SeededRandom(1),
  ) {}

  /** Wire a persistence callback invoked after every state-mutating command (0030). */
  setOnPersist(fn: () => void): void {
    this.onPersist = fn;
  }

  recordInteraction(req: RecordInteractionReq): { eventId: string } {
    const eventId = `evt:mcp:${++this.seq}`;
    this.events.record({
      id: eventId, ts: this.seq, type: "conversation",
      initiator: req.initiator, witnessSet: req.witnessSet,
      hidden: !req.witnessSet.includes(PLAYER), content: req.content,
    });
    // Consequence (0023): the initiator's action moves how the OTHERS feel about them — a real,
    // recorded, HIDDEN shift (the engine owns the magnitude; the player never sees the numbers).
    if (this.rel && req.kind && INTERACTION_KINDS.has(req.kind)) {
      const others = req.toward ?? req.witnessSet.filter((w) => w !== req.initiator);
      for (const o of others) this.rel.applyDirected(o, req.initiator, req.kind as InteractionType, this.rng);
    }
    this.onPersist?.(); // durable save (0030): events + the hidden layer survive a restart
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

  diaryRoom(req: DiaryRoomReq): { recorded: true } {
    // OOC player knowledge with NO in-game pathway to any NPC (0013): the recorded event's
    // witness set is the player alone, and deriveNpcKnowledge filters the diary-room pathway —
    // so the house can never learn it. The player's strategy may inform the engine, never NPCs.
    this.knowledge.recordDiaryRoom(req.entry);
    this.onPersist?.(); // durable save (0030): the player's DR is their persisted knowledge
    return { recorded: true };
  }
}
