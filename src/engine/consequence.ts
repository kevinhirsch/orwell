import type { EntityId } from "../domain/ids";
import { PLAYER } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EventStore } from "../ports/EventStore";
import type { GameEvent } from "../domain/event";
import { RelationshipModel } from "./relationships";
import type { InteractionType, EdgeSignals } from "./relationships";
import {
  CONSEQUENCE_DIRECTION_IMPACTS, CONSEQUENCE_EMPHASIS, scaleImpact,
  type ConsequenceDirection,
} from "./relationshipConstants";
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
/**
 * A per-edge consequence PROPOSAL (ADR 0005 — the generative path). The caller/LLM reads the scene
 * and proposes WHICH directed edge moves, in WHICH direction, with what RELATIVE emphasis. The engine
 * owns the AMOUNT (it maps `direction`→signal+sign and `emphasis`→a bounded multiplier of its OWN
 * base) — so a proposal can never inflate how far a hidden number moves (anti-sycophancy #3).
 */
export interface EdgeConsequence {
  /** Whose hidden opinion of the initiator moves. */
  toward: EntityId;
  /** Which signal(s) move and their sign — a member of the closed `EdgeSignals` space. */
  direction: ConsequenceDirection;
  /** RELATIVE weight only (NOT a magnitude). */
  emphasis?: "slight" | "notable" | "strong";
}

/**
 * The generative-consequence descriptor (ADR 0005). Open-set interpretation (which edge, which
 * direction, why) rides here + the free-text `content`; the magnitude stays engine-owned. The
 * `rationale` is RECORDED (open-set content) but NEVER scored into any magnitude.
 */
export interface ConsequenceDescriptor {
  edges?: EdgeConsequence[];
  rationale?: string;
}

export interface Happening {
  initiator: EntityId;
  witnessSet: EntityId[];
  content: string;
  /** The interaction's nature (caller/LLM-proposed); the engine applies the magnitude (0017). */
  kind?: InteractionType;
  /** Whose hidden opinion of the initiator moves (default: the other witnesses). */
  toward?: EntityId[];
  /**
   * The OPTIONAL generative-consequence descriptor (ADR 0005). When present it REFINES the
   * partner-edge targeting/direction; `kind` stays the floor (it may still seed the base magnitude).
   * Absent ⇒ the fold is byte-identical to the `kind`-only path.
   */
  consequence?: ConsequenceDescriptor;
  /** Event kind for the record (default "conversation"). */
  type?: string;
}

export interface MemorySnapshot {
  events: GameEvent[];
  relationships: { edges: Array<{ from: EntityId; to: EntityId } & EdgeSignals> };
  seq: number;
  tick: number;
}

/**
 * THE hidden-impact fold (0023 — B59 collapsed the duplicate): the initiator's action moves how
 * the OTHERS feel about the initiator. The engine owns the magnitude (anti-sycophancy); callers
 * may propose the interaction's nature and a bounded `cap` (B39's flood guard). Used by BOTH the
 * 0023 ConsequenceEngine and the live `recordInteraction` seam — one implementation, zero drift.
 */
export function foldHiddenImpact(
  rel: RelationshipModel,
  rng: RandomnessSource,
  initiator: EntityId,
  witnessSet: readonly EntityId[],
  kind: InteractionType,
  toward?: readonly EntityId[],
  cap = Number.POSITIVE_INFINITY,
  bystanders?: readonly EntityId[],
): void {
  // PARTNERS — those the initiator actually engaged: the full directed fold.
  const partners = (toward ?? witnessSet.filter((w) => w !== initiator)).slice(0, cap);
  for (const o of partners) rel.applyDirected(o, initiator, kind, rng);
  // BYSTANDERS — co-present witnesses who merely SAW it (audit 2026-06-18): each reacts by their
  // OWN beliefs, small and individuated, never the partner's full bond and never a uniform step.
  if (bystanders) {
    const seen = new Set(partners);
    for (const b of bystanders) {
      if (b === initiator || seen.has(b)) continue;
      rel.applyObservation(b, initiator, partners, kind, rng);
    }
  }
}

/**
 * The GENERATIVE-consequence fold (ADR 0005 — "split authority by openness"). Where `foldHiddenImpact`
 * collapses every social scene onto ONE global 7-way `kind` magnitude, this lets the caller/LLM propose
 * a PER-EDGE shape — which directed signal moves, in which direction, with what relative emphasis —
 * read off the specific scene. The engine still OWNS the amount (anti-sycophancy #3): the caller's
 * `direction` only selects which engine-owned base impact applies, and `emphasis` only picks a bounded,
 * clamped multiplier of it; no raw number ever crosses from the caller. Folds run through the SAME
 * proven update rule (`applyImpactDirected` → disposition × jitter × clamp) as every other fold.
 *
 * Important subtlety (ADR 0005): the relationship SIGNAL space (trust/affinity/threat/alignment) is
 * legitimately a small CLOSED, finite set — `direction` names a member of it, and that is fine. What
 * stays OPEN is the *interpretation* of the scene, which lives in the free-text `content` + the
 * recorded `rationale`, never collapsed. The generative win is the per-edge, scene-chosen
 * direction/targeting/emphasis REPLACING the single global `kind` — not a new closed enum by the back
 * door (these directions are just the existing edge signals, exposed).
 *
 * Returns the set of `toward` entities whose PARTNER edge the descriptor moved, so the caller can run
 * its own bystander pass on the witnesses the descriptor did NOT name (the partner/bystander split
 * stays the caller's, exactly as in the `kind`-only path). Respects the per-edge `cap` budget.
 */
export function foldGenerativeConsequence(
  rel: RelationshipModel,
  rng: RandomnessSource,
  initiator: EntityId,
  edges: readonly EdgeConsequence[],
  spend: (toward: EntityId) => boolean = () => true,
): Set<EntityId> {
  const moved = new Set<EntityId>();
  for (const e of edges) {
    if (e.toward === initiator) continue; // an action never folds onto its own initiator
    if (!spend(e.toward)) continue; // the per-beat-per-edge budget (E21) gates the descriptor too
    const base = CONSEQUENCE_DIRECTION_IMPACTS[e.direction];
    const factor = CONSEQUENCE_EMPHASIS[e.emphasis ?? "notable"]; // RELATIVE weight → engine multiplier
    rel.applyImpactDirected(e.toward, initiator, scaleImpact(base, factor), rng);
    moved.add(e.toward);
  }
  return moved;
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
    // The generative path (ADR 0005): a supplied descriptor refines the PARTNER-edge targeting/
    // direction (the engine still owns the amount). The named edges take the per-edge fold; any
    // `kind` then runs the bystander pass over the witnesses the descriptor did NOT name, so the
    // tag stays the floor. With NO descriptor, this is byte-identical to the prior `kind`-only path.
    const named = h.consequence?.edges?.length
      ? foldGenerativeConsequence(this.rel, this.rng, h.initiator, h.consequence.edges)
      : null;
    if (h.kind) {
      if (named) {
        const bystanders = h.witnessSet.filter((w) => w !== h.initiator && !named.has(w));
        foldHiddenImpact(this.rel, this.rng, h.initiator, h.witnessSet, h.kind, [], undefined, bystanders);
      } else {
        foldHiddenImpact(this.rel, this.rng, h.initiator, h.witnessSet, h.kind, h.toward);
      }
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
