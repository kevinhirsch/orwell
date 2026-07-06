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
    expect(store.queryAll()).toHaveLength(0);
  });
});

describe("BE-6 — EventStore.query() fails CLOSED (no accidental full/Vault-inclusive read)", () => {
  it("a bare, filterless query() throws instead of fast-pathing to the full log", () => {
    const store = new InMemoryEventStore();
    store.record(base({ id: "visible", witnessSet: [PLAYER], hidden: false }));
    store.record(base({ id: "hidden", witnessSet: [npc(1)], hidden: true }));
    // `{}` type-checks (every EventQuery field is optional) but sets NO field — this proves the
    // RUNTIME guard fires for exactly that case, not just a caller that omits the argument entirely.
    expect(() => store.query({})).toThrow(/requires an explicit filter/);
  });

  it("query() with an explicit filter still works normally (witnessedBy/hidden/type all honored)", () => {
    const store = new InMemoryEventStore();
    store.record(base({ id: "visible", witnessSet: [PLAYER], hidden: false, type: "conversation" }));
    store.record(base({ id: "hidden", witnessSet: [npc(1)], hidden: true, type: "confessional" }));
    expect(store.query({ witnessedBy: PLAYER }).map((e) => e.id)).toEqual(["visible"]);
    expect(store.query({ hidden: true }).map((e) => e.id)).toEqual(["hidden"]);
    expect(store.query({ type: "confessional" }).map((e) => e.id)).toEqual(["hidden"]);
  });

  it("queryAll() is the explicit escape hatch: it returns EVERYTHING, hidden Vault content included", () => {
    const store = new InMemoryEventStore();
    store.record(base({ id: "visible", witnessSet: [PLAYER], hidden: false }));
    store.record(base({ id: "hidden", witnessSet: [npc(1)], hidden: true }));
    expect(store.queryAll().map((e) => e.id).sort()).toEqual(["hidden", "visible"]);
  });
});
