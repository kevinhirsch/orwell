import { describe, it, expect } from "vitest";
import { validateEvent } from "../../src/domain/event";
import type { GameEvent } from "../../src/domain/event";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { PLAYER, npc } from "../../src/domain/ids";

const base = (over: Partial<GameEvent>): GameEvent => ({
  id: "e", ts: 1, type: "conversation", initiator: PLAYER,
  witnessSet: [PLAYER], hidden: false, content: "x", ...over,
});

describe("event visibility invariant", () => {
  it("accepts a player-witnessed event that is not hidden", () => {
    expect(() => validateEvent(base({ witnessSet: [PLAYER, npc(1)], hidden: false }))).not.toThrow();
  });

  it("accepts an unwitnessed event that is hidden", () => {
    expect(() => validateEvent(base({ witnessSet: [npc(1), npc(2)], hidden: true }))).not.toThrow();
  });

  it("rejects mislabeling a player-witnessed event as hidden (the regression guard)", () => {
    expect(() => validateEvent(base({ witnessSet: [PLAYER], hidden: true }))).toThrow();
  });

  it("rejects an unwitnessed event marked not-hidden", () => {
    expect(() => validateEvent(base({ witnessSet: [npc(1)], hidden: false }))).toThrow();
  });

  it("the store refuses to persist a mislabeled event", () => {
    const store = new InMemoryEventStore();
    expect(() => store.record(base({ witnessSet: [PLAYER], hidden: true }))).toThrow();
    expect(store.query()).toHaveLength(0);
  });
});
