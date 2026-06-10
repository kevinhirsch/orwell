import type { EventStore } from "../ports/EventStore";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EntityId, GameEvent } from "../domain/event";
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
      id: `offscreen:${i}:${rng.int(1_000_000_000)}`,
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
 * Richer off-screen life (feature 0038): the house lives in MORE than one way —
 * each scene carries its real interaction *type* (alliance/gossip/conflict/…), so
 * the caller folds the correct hidden impact and information can travel by kind.
 * Hidden (witness excludes the player), bounded by `interactions`, seed-deterministic.
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
}): OffscreenScene[] {
  const { events, rng, npcs, interactions, hiddenElementsOf } = deps;
  const scenes: OffscreenScene[] = [];

  for (let i = 0; i < interactions; i++) {
    const a = rng.pick(npcs);
    let b = rng.pick(npcs);
    let guard = 0;
    while (b === a && guard++ < 16) b = rng.pick(npcs);
    const type = rng.pick(RICH_TYPES);

    const event: GameEvent = {
      id: `offscreen:${type}:${i}:${rng.int(1_000_000_000)}`,
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
