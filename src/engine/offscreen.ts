import type { EventStore } from "../ports/EventStore";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EntityId, GameEvent } from "../domain/event";
import type { EdgeSignals } from "./relationshipConstants";
import type { InteractionType } from "./relationships";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed, type HiddenElement } from "./characterFactory";
import { hiddenSurfaces } from "../domain/temperatureConstants";

/**
 * Minimal off-screen life: records NPC-to-NPC interactions the player is not
 * present for (witness sets exclude the player; hidden until surfaced). Feature
 * 0003 (behavioral fidelity) builds the richness/volume thresholds on top of
 * this; here it exists so the visibility model has genuine off-screen events.
 */
export function simulateOffscreenStretch(deps: {
  events: EventStore;
  rng: RandomnessSource;
  npcs: readonly EntityId[];
  interactions: number;
}): GameEvent[] {
  const { events, rng, npcs, interactions } = deps;
  const verbs = ["schemed with", "gossiped about the house with", "bonded with", "argued with"];
  const produced: GameEvent[] = [];

  for (let i = 0; i < interactions; i++) {
    const a = rng.pick(npcs);
    let b = rng.pick(npcs);
    let guard = 0;
    while (b === a && guard++ < 16) b = rng.pick(npcs);

    const event: GameEvent = {
      id: `offscreen:${events.query().length}:${rng.int(1_000_000_000)}`,
      ts: i,
      type: "conversation",
      initiator: a,
      witnessSet: [a, b],
      hidden: true,
      content: `${a} ${rng.pick(verbs)} ${b}`,
    };
    events.record(event);
    produced.push(event);
  }

  return produced;
}

/** A typed off-screen scene — the interaction's real nature, so callers fold the right impact. */
export interface OffscreenScene {
  event: GameEvent;
  type: InteractionType;
  initiator: EntityId;
  partner: EntityId;
}

/** The seven real interaction natures (matches `simulation.ts` / the relationship model). */
const RICH_VERBS: Record<InteractionType, string> = {
  alliance: "formed an alliance with",
  gossip: "gossiped about the house with",
  conflict: "clashed with",
  bonding: "bonded with",
  strategy: "talked strategy with",
  showmance: "grew close to",
  betrayal: "quietly turned on",
};
const RICH_TYPES = Object.keys(RICH_VERBS) as InteractionType[];

/**
 * Social-coherence tunables (audit E45): the off-screen society is MOTIVATED, not uniform noise.
 * Partners are drawn by the strength of any charged tie; a scene's NATURE follows the initiator's
 * actual read of that partner (affinity → bonding, alignment → strategy, threat → conflict); and
 * BETRAYAL is gated — you can only "quietly turn on" someone you genuinely bonded with, and only
 * with an incentive (a real threat read). Magnitudes live here only (the B59 pattern, like GOSSIP).
 */
export const SOCIETY = {
  /** A betrayal scene needs a PRIOR bond at least this strong — no betraying strangers. */
  betrayalBondFloor: 0.45,
  /** ...and an incentive: the initiator must read the bond-mate as at least this much threat. */
  betrayalThreatFloor: 0.25,
  /** Every (non-gated) nature keeps this floor weight so the house stays varied, never monotone. */
  baseWeight: 0.08,
  /** Gossip is ambient — a flat propensity beside the edge-driven natures. */
  gossipWeight: 0.3,
} as const;

/** One weighted draw. `weights` must be non-negative; zero-total falls back to the first item. */
function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: RandomnessSource): T {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return items[0]!;
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** The nature propensities of a scene FROM the initiator's directed read of the partner (E45). */
function natureWeights(e: EdgeSignals): number[] {
  const bond = (e.trust + e.affinity) / 2;
  return RICH_TYPES.map((t) => {
    switch (t) {
      case "bonding": return e.affinity + SOCIETY.baseWeight;
      case "showmance": return e.affinity * 0.5 + SOCIETY.baseWeight;
      case "alliance": return (e.trust + e.alignment) / 2 + SOCIETY.baseWeight;
      case "strategy": return e.alignment + SOCIETY.baseWeight;
      case "gossip": return SOCIETY.gossipWeight + SOCIETY.baseWeight;
      case "conflict": return e.threat + SOCIETY.baseWeight;
      case "betrayal":
        // Gated (E45): only over an existing bond AND with incentive — and never floored.
        return bond >= SOCIETY.betrayalBondFloor && e.threat >= SOCIETY.betrayalThreatFloor
          ? e.threat * bond
          : 0;
    }
  });
}

/**
 * Richer off-screen life (feature 0038): the house lives in MORE than one way —
 * each scene carries its real interaction *type* (alliance/gossip/conflict/…), so
 * the caller folds the correct hidden impact and information can travel by kind.
 * Hidden (witness excludes the player), bounded by `interactions`, seed-deterministic.
 *
 * With `edgeOf`/`occupancy` (audit E45) the society is socially COHERENT: scenes happen between
 * CO-PRESENT houseguests (the 0049 presence model is ground truth — no scene between people in
 * different rooms), partners are drawn by tie strength, natures follow the relationship, and
 * betrayal only fires over a real prior bond with incentive. Without those deps the legacy
 * uniform draw is preserved byte-for-byte (pure tests and the pre-wiring tick are unchanged).
 */
export function richOffscreenStretch(deps: {
  events: EventStore;
  rng: RandomnessSource;
  npcs: readonly EntityId[];
  interactions: number;
  /**
   * The initiator's hidden elements (B50). When provided, one RARELY (gated by `hiddenSurfaces`)
   * surfaces into the scene's HIDDEN content — never reaching the player without a later pathway.
   * Rolled on a per-scene SIDE rng (hashed off the event id) so the main `rng` stream is untouched.
   */
  hiddenElementsOf?: (id: EntityId) => readonly HiddenElement[];
  /** The initiator's directed relationship read (E45) — when present, scenes are motivated. */
  edgeOf?: (from: EntityId, to: EntityId) => EdgeSignals;
  /** Who is in which room (0049/E45) — when present, scenes require co-presence. */
  occupancy?: ReadonlyMap<EntityId, string>;
}): OffscreenScene[] {
  const { events, rng, npcs, interactions, hiddenElementsOf, edgeOf, occupancy } = deps;
  const scenes: OffscreenScene[] = [];

  for (let i = 0; i < interactions; i++) {
    let a: EntityId;
    let b: EntityId;
    let type: InteractionType;
    if (edgeOf) {
      // E45 — the motivated, co-present draw.
      const candidatesFor = (x: EntityId): EntityId[] => {
        const room = occupancy?.get(x);
        return npcs.filter((n) => n !== x && (!occupancy || occupancy.get(n) === room));
      };
      const initiators = npcs.filter((n) => candidatesFor(n).length > 0);
      if (initiators.length === 0) break; // nobody shares a room with anybody — no scene to have
      a = rng.pick(initiators);
      const candidates = candidatesFor(a);
      b = weightedPick(
        candidates,
        // Any charged tie pulls a pair together: warmth, shared agenda, or friction.
        candidates.map((c) => {
          const e = edgeOf(a, c);
          return e.affinity + e.alignment + e.threat + SOCIETY.baseWeight;
        }),
        rng,
      );
      type = weightedPick(RICH_TYPES, natureWeights(edgeOf(a, b)), rng);
    } else {
      // The legacy uniform draw (kept byte-stable for pure tests and the pre-E45 tick).
      a = rng.pick(npcs);
      b = rng.pick(npcs);
      let guard = 0;
      while (b === a && guard++ < 16) b = rng.pick(npcs);
      type = rng.pick(RICH_TYPES);
    }

    const event: GameEvent = {
      // Store-size-keyed id (the B40 lesson, found live by the B71 smoke): a restarted process
      // re-seeds the per-user rng, so an index+rng id REGENERATES identically against a restored
      // store and the duplicate-id guard kills the tick. The store size is restart-monotonic.
      id: `offscreen:${type}:${events.query().length}:${rng.int(1_000_000_000)}`,
      ts: i,
      type,
      initiator: a,
      witnessSet: [a, b],
      hidden: true,
      content: `${a} ${RICH_VERBS[type]} ${b}`,
    };
    // B50: a hidden element of the initiator occasionally slips into the (still-hidden) scene — the
    // rare-reveal "treat" loop. The side rng keeps the main stream byte-stable; the content stays hidden.
    if (hiddenElementsOf) {
      const side = new SeededRandom(hashSeed(event.id));
      if (hiddenSurfaces(side)) {
        const els = hiddenElementsOf(a);
        if (els.length > 0) {
          event.content += ` — ${a} ${els[side.int(els.length)]!.detail}`;
          event.reveal = true; // structural (B54): the richness gate counts reveals from the store
        }
      }
    }
    events.record(event);
    scenes.push({ event, type, initiator: a, partner: b });
  }

  return scenes;
}
