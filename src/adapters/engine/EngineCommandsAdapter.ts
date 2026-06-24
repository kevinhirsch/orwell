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
import { foldHiddenImpact, foldGenerativeConsequence } from "../../engine/consequence";
import { rollOverhears } from "../../engine/presence";
import type { Occupancy } from "../../domain/house";
import { StaleBeatError, EngineRefusal } from "../../domain/errors";
import { IMAGE_BUDGET } from "../../engine/imageConstants";

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
  /** 0066 Phase-2 play-clock: advance in-game time when the PLAYER has a conversation. Unset ⇒ no-op. */
  private conversationClock?: (kind: string) => void;
  /** The living houseguests an interaction may name (B39); when unset, validation is skipped (standalone). */
  private livingProvider?: () => Iterable<EntityId>;
  /** The live occupancy ground truth (0049); when unset, scenes are placeless (standalone — prior behavior). */
  private presenceProvider?: () => Occupancy | null;
  /**
   * L27: index a recorded social scene into a houseguest's SEMANTIC recall memory (0024). Every
   * houseguest who was in a scene remembers its SUMMARY, so later narrative is built from the STORE
   * recalled (ADR 0003), never the chat window. Unset = standalone (no recall index — prior behavior).
   */
  private soulMemo?: (hg: EntityId, content: string) => void;
  /**
   * 0065 Part A — the compare-and-swap stale-write guard for this command port. The authoritative
   * monotonic `beatSeq` lives on the session adapter (it owns the snapshot it is persisted in); the
   * registry wires these so this adapter can READ the current counter + the Vault-free current board
   * to compose the typed `stale-beat` refusal. Unset (standalone) ⇒ the guard is skipped (a missing
   * `expectedBeatSeq` is always opt-out anyway — byte-identical to today).
   */
  private beatSeqProvider?: () => number;
  private boardProvider?: () => unknown;
  /** E21: the beat window the fold budget counts within, plus the per-edge tallies inside it. */
  private foldBeatKey = "";
  private readonly foldCounts = new Map<string, number>();
  /**
   * IMG-NEW-1: the image-generation budget tallies (`IMAGE_BUDGET`). Generation is the most
   * expensive lever, so a per-TURN (beat-window) and per-WEEK ceiling bounds the in-game re-shoot
   * paths (facet re-shoot, manual backfill, the studio's "regenerate"). The season-start move-in
   * portrait set is EXEMPT (`moveInPortraitExempt`) — detected structurally as the FIRST image for a
   * houseguest, so the bounded one-time cast shoot never trips the cap while every RE-generation of an
   * already-portrayed houseguest counts. Keyed like `foldCounts`: the count resets when the window
   * (beat / week) rolls over. Tallies are in-memory (a restart re-opens the budget — a restart is no
   * cheap abuse loop), but the EXEMPTION reads the persisted event log, so it stays correct across one.
   */
  private imageTurnKey = "";
  private imageTurnCount = 0;
  private imageWeekKey = "";
  private imageWeekCount = 0;
  /**
   * R3 (Part E latency tail) — an incremental cache for `currentBeatKey`. The window key is "the latest
   * recorded `season:` event id"; the log is APPEND-ONLY, so that latest id is MONOTONIC — it can only move
   * forward as new beats append, never backward. We cache the last answer + the event-count it was computed
   * at, and on the next call scan only the TAIL appended since (`eventsSince` — O(Δ)) backward for a fresh
   * `season:` beat; if the tail holds none, the cached key is still the latest. This replaces the per-
   * `recordInteraction` BACKWARD scan of the WHOLE log (which, between beats, walked every accumulated
   * interaction/gossip/confessional event — O(events), the season-length latency tail). `count()` is the
   * cache key (it only ever grows under append-only), so a miss is always a fresh, correct recompute.
   */
  private beatKeyCache: { atCount: number; key: string } | null = null;

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

  /** 0066 Phase-2: wire the play-clock so a recorded PLAYER conversation advances in-game time by its
   *  kind's cost (the registry points this at `session.advanceClockForConversation`). Unset ⇒ no-op. */
  setConversationClock(fn: (kind: string) => void): void {
    this.conversationClock = fn;
  }

  /** Wire the living-houseguest set so a recorded interaction can't name an evicted/unknown player (B39). */
  setLivingProvider(fn: () => Iterable<EntityId>): void {
    this.livingProvider = fn;
  }

  /** Wire the house occupancy (0049) so recorded scenes gain co-present witnesses + adjacent overhears. */
  setPresenceProvider(fn: () => Occupancy | null): void {
    this.presenceProvider = fn;
  }

  /** Wire the semantic-recall index (L27/0024) so a recorded social scene becomes recallable later. */
  setSoulMemo(fn: (hg: EntityId, content: string) => void): void {
    this.soulMemo = fn;
  }

  /**
   * 0065 Part A — wire the session's monotonic `beatSeq` reader + the Vault-free board reader so this
   * command port can enforce the compare-and-swap stale-write guard (the counter is owned/persisted by
   * the session adapter). Standalone adapters that never wire these simply skip the guard.
   */
  setBeatSeqProvider(fn: () => number): void {
    this.beatSeqProvider = fn;
  }

  setBoardProvider(fn: () => unknown): void {
    this.boardProvider = fn;
  }

  /**
   * 0065 Part A — refuse a write computed against a superseded board BEFORE any mutation. A present
   * `expectedBeatSeq` that no longer matches the session's committed counter throws a typed
   * `stale-beat` conflict carrying the CURRENT counter + the Vault-free board (HTTP 409). Absent ⇒
   * opt-out (byte-identical to the pre-0065 path); unwired providers ⇒ skipped.
   */
  private guardBeatSeq(expected: number | undefined): void {
    if (expected === undefined || !this.beatSeqProvider) return;
    const current = this.beatSeqProvider();
    if (expected !== current) throw new StaleBeatError(current, this.boardProvider?.() ?? null);
  }

  recordInteraction(req: RecordInteractionReq): { eventId: string } {
    // 0065 Part A — refuse a scene computed against a superseded board BEFORE recording/folding.
    this.guardBeatSeq(req.expectedBeatSeq);
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
    const n = this.events.count();
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
    //
    // Two paths, both engine-owned magnitude (anti-sycophancy #3):
    //  • The generative path (ADR 0005): when a `consequence` descriptor names per-edge directions,
    //    those PARTNER edges fold by their scene-chosen direction/emphasis (the LLM reads the scene;
    //    the engine still sets the amount). A novel move that fits NO enum still folds here — it must
    //    never evaporate (ADR 0005 principle #4). Any `kind` then runs the bystander pass over the
    //    witnesses the descriptor did NOT name, so the 7-way tag stays the FLOOR, never the ceiling.
    //  • The `kind`-only floor: with NO descriptor, this is BYTE-IDENTICAL to the prior behavior.
    const genEdges = req.consequence?.edges;
    if (this.rel && (genEdges?.length || (req.kind && INTERACTION_KINDS.has(req.kind)))) {
      this.rollBeatWindow();
      let named: Set<EntityId>;
      if (genEdges?.length) {
        // The descriptor drives the partner folds — each named edge spends one unit of the per-beat
        // per-edge budget (E21) exactly as a `kind` partner would.
        named = foldGenerativeConsequence(
          this.rel, this.rng, req.initiator, genEdges,
          (toward) => toward !== req.initiator && this.spendFoldBudget(toward, req.initiator),
        );
        // If a `kind` ALSO rides along, it observes the room MINUS the descriptor's named edges (the
        // tag is the floor): co-present witnesses not named by the descriptor react by their own
        // beliefs. A private generative bond must never bond the whole room (audit 2026-06-18).
        if (req.kind && INTERACTION_KINDS.has(req.kind)) {
          const bystanders = witnessSet.filter(
            (w) => w !== req.initiator && !named.has(w) && this.spendFoldBudget(w, req.initiator),
          );
          foldHiddenImpact(this.rel, this.rng, req.initiator, witnessSet, req.kind as InteractionType,
            [], MAX_FOLDS_PER_INTERACTION, bystanders);
        }
      } else {
        // PARTNERS — only those the initiator actually ENGAGED (the caller-named witnesses, or an
        // explicit `toward`) take the full directed fold. Presence-grounding adds co-present
        // bystanders to the witness set, but a private bond must never bond the whole room (audit
        // 2026-06-18): bystanders only OBSERVE, reacting by their own beliefs (foldHiddenImpact).
        const partnerNames = req.toward ?? req.witnessSet.filter((w) => w !== req.initiator);
        const namedSet = new Set(partnerNames);
        const partners = partnerNames.filter((o) => o !== req.initiator && this.spendFoldBudget(o, req.initiator));
        const bystanders = witnessSet.filter(
          (w) => w !== req.initiator && !namedSet.has(w) && this.spendFoldBudget(w, req.initiator),
        );
        foldHiddenImpact(this.rel, this.rng, req.initiator, witnessSet, req.kind as InteractionType,
          partners, MAX_FOLDS_PER_INTERACTION, bystanders);
      }
    }
    // L27: index the scene's SUMMARY into each houseguest's semantic recall memory (0024) — every
    // houseguest who was in it remembers it, so later story/narrative is built from the STORE recalled
    // (ADR 0003), never the chat window. The player's own knowledge already lives in the event record.
    if (this.soulMemo) {
      for (const w of witnessSet) if (w !== PLAYER) this.soulMemo(w, req.content);
    }
    // ADR 0005: the descriptor's `rationale` is OPEN-SET content (the LLM's reading of WHY the scene
    // mattered). It is RECORDED — a separate player-witnessed event so the scene's own `content` stays
    // byte-equal (lossless) — and NEVER scored into any magnitude (no fold reads it). Recording it
    // makes the generative reasoning recallable; it just never moves a hidden number.
    const rationale = req.consequence?.rationale;
    if (rationale && rationale.length) {
      const rn = this.events.count();
      this.events.record({
        id: `evt:mcp:${rn}`, ts: rn, type: "consequence-rationale",
        initiator: req.initiator, witnessSet: [...witnessSet],
        hidden: !witnessSet.includes(PLAYER), content: rationale,
      });
      if (this.soulMemo) for (const w of witnessSet) if (w !== PLAYER) this.soulMemo(w, rationale);
    }
    // 0066 Phase-2: a player conversation costs in-game time (the play-clock). recordInteraction is
    // player-witnessed only, so this fires exactly on the player's own scenes; the cost follows the kind
    // (substantive scenes read longer). Gated downstream ⇒ no-op when the clock is off. Before persist so
    // the advanced clock is captured in the same save.
    if (req.kind) this.conversationClock?.(req.kind);
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

  /**
   * The current beat window: the latest recorded season beat's id (pre-season counts as one window).
   *
   * R3 — INCREMENTAL: the log is append-only, so the latest `season:` id is monotonic. We scan only the
   * tail appended since the last call (`eventsSince(atCount)` — O(Δ)); a tail with a fresh beat updates
   * the cache, an empty/beat-free tail reuses the cached key, and a count that hasn't moved is the
   * cached key verbatim. The result is byte-identical to the old whole-log backward scan: the old scan
   * returned the highest-index `season:` event's id (or `"pre-season"` if none ever recorded), and the
   * cache, being monotonic and seeded once from `"pre-season"`, holds exactly that. (`count()` is the
   * cache key; it only grows under append-only, so a stale cache is impossible — a miss recomputes.)
   */
  private currentBeatKey(): string {
    const count = this.events.count();
    if (this.beatKeyCache && this.beatKeyCache.atCount === count) return this.beatKeyCache.key;
    const from = this.beatKeyCache ? this.beatKeyCache.atCount : 0;
    let key = this.beatKeyCache?.key ?? "pre-season";
    const tail = this.events.eventsSince(from); // O(Δ): only the events appended since the last call
    for (let i = tail.length - 1; i >= 0; i--) {
      if (tail[i]!.id.startsWith("season:")) { key = tail[i]!.id; break; } // latest fresh beat in the tail
    }
    this.beatKeyCache = { atCount: count, key };
    return key;
  }

  surfaceInformationTo(req: SurfaceReq): { ok: true; surfaced: boolean } {
    // 0065 Part A — refuse a surfacing computed against a superseded board BEFORE anything anchors.
    this.guardBeatSeq(req.expectedBeatSeq);
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

  recordImageBeat(req: { houseguestId: EntityId; imageRef: string }): { eventId: string } {
    // 0051: an image shown to the player in-character is a BEAT — recorded like any scene, so it
    // has consequence and memory ("recorded or it didn't happen"). Player-witnessed by construction
    // (the witness set is the player — they saw it); never hidden. No hidden-layer write: the image
    // is built only from the player's visible state, so showing it is the player's own knowledge.

    // IMG-NEW-1: enforce the generation budget (`IMAGE_BUDGET`). The season-start MOVE-IN portrait
    // (the FIRST image for a houseguest) is exempt — a bounded one-time cast cost; every RE-generation
    // of an already-portrayed houseguest is metered against the per-turn + per-week caps so a looping
    // model / button-masher / public-exposure abuser has an engine-side spend ceiling. Refused past the
    // cap with a typed `EngineRefusal` (HTTP 400) so the FE generation loop can stop re-shooting.
    if (!IMAGE_BUDGET.moveInPortraitExempt || this.hasPriorImageFor(req.houseguestId)) {
      const turnKey = this.currentBeatKey();
      if (turnKey !== this.imageTurnKey) { this.imageTurnKey = turnKey; this.imageTurnCount = 0; }
      const weekKey = String((this.boardProvider?.() as { week?: number } | undefined)?.week ?? "");
      if (weekKey !== this.imageWeekKey) { this.imageWeekKey = weekKey; this.imageWeekCount = 0; }
      if (this.imageTurnCount >= IMAGE_BUDGET.perTurnCap) {
        throw new EngineRefusal(`image budget exhausted for this turn (max ${IMAGE_BUDGET.perTurnCap} generations)`);
      }
      if (this.imageWeekCount >= IMAGE_BUDGET.perWeekCap) {
        throw new EngineRefusal(`image budget exhausted for this week (max ${IMAGE_BUDGET.perWeekCap} generations)`);
      }
      this.imageTurnCount += 1;
      this.imageWeekCount += 1;
    }

    // Monotonic, restart-safe id off the store size (same discipline as recordInteraction, B40).
    const n = this.events.count();
    const eventId = `evt:image:${n}`;
    this.events.record({
      id: eventId, ts: n, type: "image-shown",
      initiator: PLAYER, witnessSet: [PLAYER],
      hidden: false, content: `image shown to the player: ${req.houseguestId} (${req.imageRef})`,
    });
    this.onPersist?.(); // durable save (0030): the image beat survives a restart
    return { eventId };
  }

  /**
   * IMG-NEW-1 exemption: has this houseguest ALREADY had an image shown? The first image per
   * houseguest is the move-in/season-start portrait (exempt from the budget); a second or later one is
   * a metered RE-generation. Reads the persisted `image-shown` log (the same `content` `recordImageBeat`
   * writes), so the exemption stays correct across a restart even though the in-memory tallies reset.
   */
  private hasPriorImageFor(houseguestId: EntityId): boolean {
    const marker = `image shown to the player: ${houseguestId} (`;
    return this.events.query({ type: "image-shown" }).some((e) => e.content.startsWith(marker));
  }
}
