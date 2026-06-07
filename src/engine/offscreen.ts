import type { EventStore } from "../ports/EventStore";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { EntityId, GameEvent } from "../domain/event";

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
