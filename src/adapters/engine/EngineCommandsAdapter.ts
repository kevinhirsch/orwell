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
/** Cap the hidden folds a single recorded interaction may apply, so a caller can't flood the layer (B39). */
const MAX_FOLDS_PER_INTERACTION = 12;

export class EngineCommandsAdapter implements EngineCommands {
  /** Save-on-mutation hook (0030); the registry wires it to persist the user's snapshot. */
  private onPersist?: () => void;
  /** The living houseguests an interaction may name (B39); when unset, validation is skipped (standalone). */
  private livingProvider?: () => Iterable<EntityId>;

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

  /** Wire the living-houseguest set so a recorded interaction can't name an evicted/unknown player (B39). */
  setLivingProvider(fn: () => Iterable<EntityId>): void {
    this.livingProvider = fn;
  }

  recordInteraction(req: RecordInteractionReq): { eventId: string } {
    // Validated references (B39/audit A4): an interaction may only name LIVING houseguests — never an
    // evicted or invented one. The player is always living. Skipped when no roster is wired (standalone).
    if (this.livingProvider) {
      const living = new Set<EntityId>([PLAYER, ...this.livingProvider()]);
      for (const id of [req.initiator, ...req.witnessSet]) {
        if (!living.has(id)) throw new Error(`recordInteraction names a non-living houseguest: ${id}`);
      }
    }
    // Derive the id + ts from the store's current size (B40/audit C2): monotonic and restart-safe —
    // after a restore the count resumes high, so a post-restart interaction never collides with a
    // pre-restart one (the old `++this.seq` restarted at 0, minting duplicate ids).
    const n = this.events.query().length;
    const eventId = `evt:mcp:${n}`;
    this.events.record({
      id: eventId, ts: n, type: "conversation",
      initiator: req.initiator, witnessSet: req.witnessSet,
      hidden: !req.witnessSet.includes(PLAYER), content: req.content,
    });
    // Consequence (0023): the initiator's action moves how the OTHERS feel about them — a real,
    // recorded, HIDDEN shift (the engine owns the magnitude; the player never sees the numbers).
    // Bounded per call (B39) so a single interaction can't flood the relationship layer.
    if (this.rel && req.kind && INTERACTION_KINDS.has(req.kind)) {
      const others = (req.toward ?? req.witnessSet.filter((w) => w !== req.initiator)).slice(0, MAX_FOLDS_PER_INTERACTION);
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

  surfaceInformationTo(req: SurfaceReq): { ok: true; surfaced: boolean } {
    // Anchored ⇒ knowledge; unanchored ⇒ a suspicion (A4). Either way it persists (the prior bug: it
    // never called onPersist, so a surfaced fact was lost on restart — mandate #4).
    const fact = this.knowledge.surfaceInformationTo(req.entity, req.fact, req.pathway);
    this.onPersist?.();
    return { ok: true, surfaced: fact !== null };
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
