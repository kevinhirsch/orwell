import type {
  EngineCommands, RecordInteractionReq, SurfaceReq, DiaryRoomReq,
} from "../../ports/EngineCommands";
import type { EventStore } from "../../ports/EventStore";
import type { KnowledgeService } from "../../ports/KnowledgeService";
import type { RandomnessSource } from "../../ports/RandomnessSource";
import type { EntityId } from "../../domain/ids";
import { PLAYER } from "../../domain/ids";
import { SeededRandom } from "../random/SeededRandom";
import type { RelationshipModel, InteractionType } from "../../engine/relationships";
import { foldHiddenImpact } from "../../engine/consequence";
import { rollOverhears } from "../../engine/presence";
import type { Occupancy } from "../../domain/house";

const INTERACTION_KINDS: ReadonlySet<string> = new Set<InteractionType>([
  "alliance", "gossip", "conflict", "bonding", "strategy", "showmance", "betrayal",
]);

/**
 * Engine-side implementation of the Vault-free command port. It may touch the
 * core to decide but returns only Vault-free results. This lives on the ENGINE
 * side; the MCP server depends on the `EngineCommands` interface, not on this
 * class. (E20: the caller-supplied-stats `resolveCompetition` seam is GONE —
 * `runCompetition` on the session is the single competition authority.)
 *
 * With a relationship model wired in (0023), `recordInteraction` is no longer a
 * no-op log: a happening with a proposed `kind` folds its HIDDEN impact into the
 * layer (how the others feel about the initiator) — invisible to the player.
 */
/** Cap the hidden folds a single recorded interaction may apply, so a caller can't flood the layer (B39). */
const MAX_FOLDS_PER_INTERACTION = 12;

/**
 * E21: the per-BEAT, per-directed-edge fold budget. The per-call cap alone let a caller pump one
 * edge without bound by repeating identical calls within a single game beat; within one beat
 * window (one resolved season beat to the next), at most this many folds may land on any single
 * `witness → initiator` edge — further identical calls still record their events (the scene
 * happened) but move nothing. The budget re-opens when the loop advances to the next beat.
 */
const MAX_FOLDS_PER_PAIR_PER_BEAT = 3;

export class EngineCommandsAdapter implements EngineCommands {
  /** Save-on-mutation hook (0030); the registry wires it to persist the user's snapshot. */
  private onPersist?: () => void;
  /** The living houseguests an interaction may name (B39); when unset, validation is skipped (standalone). */
  private livingProvider?: () => Iterable<EntityId>;
  /** The live occupancy ground truth (0049); when unset, scenes are placeless (standalone — prior behavior). */
  private presenceProvider?: () => Occupancy | null;
  /** E21: the beat window the fold budget counts within, plus the per-edge tallies inside it. */
  private foldBeatKey = "";
  private readonly foldCounts = new Map<string, number>();

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

  /** Wire the house occupancy (0049) so recorded scenes gain co-present witnesses + adjacent overhears. */
  setPresenceProvider(fn: () => Occupancy | null): void {
    this.presenceProvider = fn;
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
    // E21: this is the PLAYER channel's recording seam — it may only record scenes the player is
    // part of. The player initiating counts (they are in the scene; their seat is made explicit).
    // A witness set excluding the player would mint an off-screen "ground truth" indistinguishable
    // from the engine's own hidden scenes; off-screen life is the ENGINE's to mint (0038), never a
    // caller's. Refused outright — the Vault's hidden layer cannot be written from this channel.
    const witnessSet = [...req.witnessSet];
    if (req.initiator === PLAYER && !witnessSet.includes(PLAYER)) witnessSet.push(PLAYER);
    if (!witnessSet.includes(PLAYER)) {
      throw new Error("recordInteraction is player-witnessed only: the witness set must include the player (off-screen scenes are the engine's to mint)");
    }
    // Presence grounds the scene (0049): everyone in the initiator's ROOM is a witness — being in
    // the room means you saw it (co-presence ⇒ witness; ADR 0003 §8). Caller-named witnesses are
    // kept (presence only ADDS, never drops). Placeless (no provider / no room) keeps prior behavior.
    const occupancy = this.presenceProvider?.() ?? null;
    const room = occupancy?.get(req.initiator);
    if (occupancy && room) {
      for (const [id, where] of occupancy) {
        if (where === room && !witnessSet.includes(id)) witnessSet.push(id);
      }
    }
    // Derive the id + ts from the store's current size (B40/audit C2): monotonic and restart-safe —
    // after a restore the count resumes high, so a post-restart interaction never collides with a
    // pre-restart one (the old `++this.seq` restarted at 0, minting duplicate ids).
    const n = this.events.query().length;
    const eventId = `evt:mcp:${n}`;
    this.events.record({
      id: eventId, ts: n, type: "conversation",
      initiator: req.initiator, witnessSet,
      hidden: !witnessSet.includes(PLAYER), content: req.content,
    });
    // Adjacency overhears (0049): occupants of the rooms NEXT DOOR may catch a piece of the scene —
    // an NPC overhearing the player's conversation, exactly as the player overhears NPCs. Gated,
    // recorded, traceable (`overheard:<eventId>`), partial and lower-confidence.
    if (occupancy && room) {
      rollOverhears({
        eventId, room, content: req.content, participants: witnessSet,
        occupancy, knowledge: this.knowledge, rng: this.rng,
      });
    }
    // Consequence (0023): the initiator's action moves how the OTHERS feel about them — a real,
    // recorded, HIDDEN shift (the engine owns the magnitude; the player never sees the numbers).
    // ONE fold implementation (B59): shared with the 0023 ConsequenceEngine; bounded per call (B39)
    // AND per beat per edge (E21) — repeating an identical call can't pump an edge without bound.
    if (this.rel && req.kind && INTERACTION_KINDS.has(req.kind)) {
      this.rollBeatWindow();
      const toward = (req.toward ?? witnessSet.filter((w) => w !== req.initiator))
        .filter((o) => this.spendFoldBudget(o, req.initiator));
      foldHiddenImpact(this.rel, this.rng, req.initiator, witnessSet, req.kind as InteractionType, toward, MAX_FOLDS_PER_INTERACTION);
    }
    this.onPersist?.(); // durable save (0030): events + the hidden layer survive a restart
    return { eventId };
  }

  /**
   * E21: roll the fold-budget window forward if the loop has advanced. The window is keyed off the
   * most recent recorded season beat (`season:` event) — a new beat re-opens every edge's budget.
   */
  private rollBeatWindow(): void {
    const key = this.currentBeatKey();
    if (key !== this.foldBeatKey) {
      this.foldBeatKey = key;
      this.foldCounts.clear();
    }
  }

  /**
   * E21: take one unit of the current beat window's fold budget for the directed edge
   * `from → initiator`; false once that edge's budget for the beat is spent.
   */
  private spendFoldBudget(from: EntityId, initiator: EntityId): boolean {
    const pair = `${from}->${initiator}`;
    const spent = this.foldCounts.get(pair) ?? 0;
    if (spent >= MAX_FOLDS_PER_PAIR_PER_BEAT) return false;
    this.foldCounts.set(pair, spent + 1);
    return true;
  }

  /** The current beat window: the latest recorded season beat's id (pre-season counts as one window). */
  private currentBeatKey(): string {
    const evs = this.events.query();
    for (let i = evs.length - 1; i >= 0; i--) {
      if (evs[i]!.id.startsWith("season:")) return evs[i]!.id;
    }
    return "pre-season";
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
