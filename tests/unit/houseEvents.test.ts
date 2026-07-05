import { describe, it, expect } from "vitest";
import { dayOfWeek, nextHouseEvent, HOUSE_EVENT_POOL } from "../../src/engine/houseEvents";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

// Audit E58 — the daily-event invariant must be satisfied by VARIED, day-indexed content,
// never one verbatim filler line repeated forever. Roles only; no houseguest names.
//
// Follow-up audit (comp-variety / product-gaps lanes): at realistic in-game call frequency
// (several ambient picks land per week, not once/day), a pool this size with an anti-repeat
// window of 1 (only the immediately preceding pick) cycled back into visibly-repeating content
// within the first few weeks of an 11-week season. The pool was widened and the anti-repeat
// window now spans several recent picks, not just the last one — asserted below.

const record = (store: InMemoryEventStore, content: string, ts: number) =>
  store.record({
    id: `t:day:${ts}`, ts, type: "house-event",
    initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content,
  });

/** Drive N sequential ambient house-event picks against a real store, returning the raw lines. */
function drawSequence(seed: number, n: number): string[] {
  const store = new InMemoryEventStore();
  const rng = new SeededRandom(seed);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const content = nextHouseEvent(store, rng, { week: 1 + Math.floor(i / 5), phase: "nominations" });
    record(store, content, i);
    lines.push(content);
  }
  return lines;
}

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

  // --- Follow-up audit fix: pool depth + a widened anti-repeat window ---

  it("the pool is deep enough for a full season at realistic call frequency", () => {
    // The audit measured roughly 5 ambient picks/week over an 11-week season (~55 picks). A
    // pool this shallow (was 12) reads as repetitive well before the season ends; require real
    // depth so a season-length draw sequence still feels varied.
    expect(HOUSE_EVENT_POOL.length).toBeGreaterThanOrEqual(25);
  });

  it("no line repeats within a window wider than just the immediately preceding pick", () => {
    const lines = drawSequence(17, 80);
    // Strip the "Week X, day Y: " stamp so we compare the underlying pool line, not the stamp.
    const bare = lines.map((c) => c.replace(/^Week \d+(, day \d+)?: /, ""));
    const WINDOW = 8; // narrower than RECENT_WINDOW's cap but wide enough to catch a window-of-1 regression
    for (let i = WINDOW; i < bare.length; i++) {
      const recent = bare.slice(i - WINDOW, i);
      expect(recent).not.toContain(bare[i]);
    }
  });

  it("draws deep variety across a season-length stretch (most of the pool gets used)", () => {
    const lines = drawSequence(23, 80);
    const seen = new Set(lines);
    // With a widened pool + anti-repeat window, 80 seeded draws should surface most distinct
    // lines, not settle into a small repeating rotation.
    expect(seen.size).toBeGreaterThanOrEqual(Math.min(20, HOUSE_EVENT_POOL.length));
  });

  it("is deterministic: the same seed reproduces the identical sequence of picks", () => {
    const a = drawSequence(29, 40);
    const b = drawSequence(29, 40);
    expect(b).toEqual(a);
    // A different seed is exceedingly unlikely to reproduce the same 40-pick sequence.
    const c = drawSequence(31, 40);
    expect(c).not.toEqual(a);
  });
});
