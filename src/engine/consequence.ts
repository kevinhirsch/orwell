import type { EntityId } from "../domain/ids";
import { PLAYER } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EventStore } from "../ports/EventStore";
import type { GameEvent } from "../domain/event";
import { RelationshipModel } from "./relationships";
import type { InteractionType, EdgeSignals } from "./relationships";
import { InMemoryEventStore } from "../adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../adapters/random/SeededRandom";

/**
 * The consequence & memory loop (feature 0023) — the MVP-1 backbone.
 *
 *   happening → recorded as an event (witness set + hidden flag, 0002)
 *            → the engine folds its HIDDEN impact into the relationship layer (0017)
 *               (trust/affinity/threat move — your action changes how they feel about you)
 *            → snapshot persists every event detail + the derived hidden state (0007)
 *            → restore recalls the full superset on return/restart — the house remembers.
 *
 * The opinion change lives in the hidden layer only; it never reaches the player (Vault Wall,
 * 0001) — the player sees later behavior, never the ledger. The ENGINE owns the magnitude
 * (anti-sycophancy); a caller may PROPOSE the interaction's nature (`kind`).
 */
export interface Happening {
  initiator: EntityId;
  witnessSet: EntityId[];
  content: string;
  /** The interaction's nature (caller/LLM-proposed); the engine applies the magnitude (0017). */
  kind?: InteractionType;
  /** Whose hidden opinion of the initiator moves (default: the other witnesses). */
  toward?: EntityId[];
  /** Event kind for the record (default "conversation"). */
  type?: string;
}

export interface MemorySnapshot {
  events: GameEvent[];
  relationships: { edges: Array<{ from: EntityId; to: EntityId } & EdgeSignals> };
  seq: number;
  tick: number;
}

export class ConsequenceEngine {
  private seq = 0;
  private tick = 0;

  constructor(
    private readonly events: EventStore,
    private readonly rel: RelationshipModel,
    private readonly rng: RandomnessSource,
  ) {}

  /** The hidden relationship layer (engine-only; never handed to a player surface). */
  relationships(): RelationshipModel {
    return this.rel;
  }

  /** Record a happening AND fold its hidden impact into the relationship layer. */
  record(h: Happening): { eventId: string } {
    const eventId = `evt:cons:${++this.seq}`;
    const ts = ++this.tick;
    this.events.record({
      id: eventId, ts, type: h.type ?? "conversation",
      initiator: h.initiator, witnessSet: h.witnessSet,
      hidden: !h.witnessSet.includes(PLAYER), content: h.content,
    });
    if (h.kind) {
      // The initiator's action moves how the OTHERS feel about the initiator.
      const others = h.toward ?? h.witnessSet.filter((w) => w !== h.initiator);
      for (const o of others) this.rel.applyDirected(o, h.initiator, h.kind, this.rng);
    }
    return { eventId };
  }

  /** A competition win is recorded as an event (consequential moment). */
  recordCompetitionWin(winner: EntityId, type: string): { eventId: string } {
    return this.record({ initiator: winner, witnessSet: [winner], content: `won the ${type} competition`, type: "competition" });
  }

  /** A vote against the player (or their interest): recorded + raises the voter's threat toward the player. */
  recordVoteAgainstPlayer(voter: EntityId, evictee: EntityId): { eventId: string } {
    const ack = this.record({ initiator: voter, witnessSet: [voter], content: `voted to evict ${evictee}`, type: "vote" });
    this.rel.applyDirected(voter, PLAYER, "conflict", this.rng); // threat ▲, affinity/trust ▼
    return ack;
  }

  /** Persist: every event detail + the derived hidden state (0007 — lossless, accumulating). */
  snapshot(): MemorySnapshot {
    return { events: this.events.query(), relationships: this.rel.serialize(), seq: this.seq, tick: this.tick };
  }
}

/**
 * Recall: rebuild a ConsequenceEngine from a snapshot — re-recording every event into a fresh
 * store and reloading the hidden state. Simulates leaving/returning and a process restart; the
 * result is a SUPERSET of what was saved (never a reset, never a thinning).
 */
export function restoreMemory(snap: MemorySnapshot, allianceThreshold = 0.5, rng: RandomnessSource = new SeededRandom(1)): ConsequenceEngine {
  const events = new InMemoryEventStore();
  for (const e of snap.events) events.record(e); // ids/ts/hidden preserved exactly
  const rel = new RelationshipModel(allianceThreshold);
  rel.load(snap.relationships.edges);
  const engine = new ConsequenceEngine(events, rel, rng);
  // Restore the counters so new happenings continue (don't collide with restored ids).
  (engine as unknown as { seq: number; tick: number }).seq = snap.seq;
  (engine as unknown as { seq: number; tick: number }).tick = snap.tick;
  return engine;
}
