import { describe, it, expect } from "vitest";
import { dayOfWeek, nextHouseEvent, HOUSE_EVENT_POOL } from "../../src/engine/houseEvents";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

// Audit E58 — the daily-event invariant must be satisfied by VARIED, day-indexed content,
// never one verbatim filler line repeated forever. Roles only; no houseguest names.

const record = (store: InMemoryEventStore, content: string, ts: number) =>
  store.record({
    id: `t:day:${ts}`, ts, type: "house-event",
    initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content,
  });

describe("dayOfWeek — the canonical beat→day mapping (E58)", () => {
  it("maps the weekly cadence Day 1 HOH → Day 5 eviction", () => {
    expect(dayOfWeek("hoh-competition")).toBe(1);
    expect(dayOfWeek("nominations")).toBe(2);
    expect(dayOfWeek("veto-competition")).toBe(3);
    expect(dayOfWeek("veto-ceremony")).toBe(4);
    expect(dayOfWeek("eviction")).toBe(5);
  });

  it("late-game beats land on the final day; non-week moments carry no day", () => {
    expect(dayOfWeek("finale")).toBe(5);
    expect(dayOfWeek("jury")).toBe(5);
    expect(dayOfWeek("setup")).toBeNull();
    expect(dayOfWeek("premiere")).toBeNull();
  });
});

describe("nextHouseEvent — varied, grounded, seeded (E58)", () => {
  it("no two consecutive house events ever share content", () => {
    const store = new InMemoryEventStore();
    const rng = new SeededRandom(7);
    let prev: string | null = null;
    for (let i = 0; i < 200; i++) {
      const content = nextHouseEvent(store, rng, { week: 1 + (i % 9), phase: "nominations" });
      expect(content).not.toBe(prev);
      record(store, content, i);
      prev = content;
    }
  });

  it("draws real variety from the pool over a stretch (not one line, not two)", () => {
    const store = new InMemoryEventStore();
    const rng = new SeededRandom(11);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const content = nextHouseEvent(store, rng, { week: 2, phase: "veto-competition" });
      record(store, content, i);
      seen.add(content);
    }
    expect(seen.size).toBeGreaterThanOrEqual(Math.min(6, HOUSE_EVENT_POOL.length));
  });

  it("is grounded in the week and the day index", () => {
    const content = nextHouseEvent(new InMemoryEventStore(), new SeededRandom(3), { week: 4, phase: "veto-ceremony" });
    expect(content).toContain("Week 4");
    expect(content).toContain("day 4");
  });

  it("is seed-deterministic and consults the store, not module memory", () => {
    const a = nextHouseEvent(new InMemoryEventStore(), new SeededRandom(5), { week: 1, phase: "eviction" });
    const b = nextHouseEvent(new InMemoryEventStore(), new SeededRandom(5), { week: 1, phase: "eviction" });
    expect(a).toBe(b);
    // A restored store (the last event re-recorded) still suppresses the repeat — restart-safe.
    const store = new InMemoryEventStore();
    record(store, a, 0);
    const c = nextHouseEvent(store, new SeededRandom(5), { week: 1, phase: "eviction" });
    expect(c).not.toBe(a);
  });

  it("every pool line is meaningful prose, name-free, and Vault-free", () => {
    expect(HOUSE_EVENT_POOL.length).toBeGreaterThanOrEqual(10);
    for (const line of HOUSE_EVENT_POOL) {
      expect(line.length).toBeGreaterThan(20); // a real happening, never empty filler
      expect(line).not.toMatch(/trust|threat|affinity|\d\.\d/i); // no hidden reads or numbers
    }
    expect(new Set(HOUSE_EVENT_POOL).size).toBe(HOUSE_EVENT_POOL.length); // all distinct
  });
});
