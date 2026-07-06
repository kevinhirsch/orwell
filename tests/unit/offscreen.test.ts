import { describe, it, expect } from "vitest";
import { simulateOffscreenStretch } from "../../src/engine/offscreen";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

const NPCS = [npc(1), npc(2), npc(3), npc(4), npc(5)];

// Off-screen life (feature 0003 / the visibility model): NPC-to-NPC events the player
// is not present for — hidden, witness set excludes the player.
describe("simulateOffscreenStretch — genuine, hidden, player-excluded off-screen events", () => {
  it("records exactly the requested number of events into the store", () => {
    const events = new InMemoryEventStore();
    const produced = simulateOffscreenStretch({ events, rng: new SeededRandom(1), npcs: NPCS, interactions: 8 });
    expect(produced).toHaveLength(8);
    expect(events.queryAll().length).toBeGreaterThanOrEqual(8);
  });

  it("every off-screen event is hidden, NPC-to-NPC, and excludes the player", () => {
    const events = new InMemoryEventStore();
    const produced = simulateOffscreenStretch({ events, rng: new SeededRandom(7), npcs: NPCS, interactions: 20 });
    for (const e of produced) {
      expect(e.hidden).toBe(true);
      expect(e.witnessSet).not.toContain(PLAYER);
      expect(e.witnessSet).toHaveLength(2);
      expect(e.witnessSet[0]).not.toBe(e.witnessSet[1]); // two distinct houseguests
      expect(NPCS).toContain(e.initiator);
    }
  });

  it("is seed-deterministic", () => {
    const a = simulateOffscreenStretch({ events: new InMemoryEventStore(), rng: new SeededRandom(3), npcs: NPCS, interactions: 10 });
    const b = simulateOffscreenStretch({ events: new InMemoryEventStore(), rng: new SeededRandom(3), npcs: NPCS, interactions: 10 });
    expect(a.map((e) => e.content)).toEqual(b.map((e) => e.content));
  });
});
