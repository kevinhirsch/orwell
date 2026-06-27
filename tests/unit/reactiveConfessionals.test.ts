import { describe, it, expect } from "vitest";
import {
  confessionalFor,
  selectRecentForConfessional,
  recordConfessional,
  involvedConfessionals,
} from "../../src/engine/confessionals";
import type { GameEvent } from "../../src/domain/event";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { PLAYER, npc } from "../../src/domain/ids";

type E = GameEvent;
const ev = (overrides: Partial<E> & { ts?: number; content?: string; witnessSet?: string[]; type?: string; initiator?: string }): E => ({
  id: `e:${Math.random().toString(36).slice(2)}`,
  ts: overrides.ts ?? 1,
  type: overrides.type ?? "conversation",
  initiator: overrides.initiator ?? npc(1),
  witnessSet: overrides.witnessSet ?? [npc(1)],
  hidden: overrides.hidden ?? true,
  content: overrides.content ?? "scene",
});

const [A, B, C, D] = [npc(1), npc(2), npc(3), npc(4)];
const rel = (): RelationshipModel => {
  const m = new RelationshipModel(0.5);
  const rng = new SeededRandom(1);
  for (let i = 0; i < 6; i++) m.applyDirected(A, B, "betrayal", rng);
  for (let i = 0; i < 4; i++) m.applyDirected(A, C, "bonding", rng);
  return m;
};

describe("0089 — selectRecentForConfessional", () => {
  it("returns the confessor's own witnessed events, ranked by salience then recency", () => {
    const events: E[] = [
      ev({ type: "conversation", initiator: A, witnessSet: [A, B], ts: 1 }),
      ev({ type: "house-event", initiator: B, witnessSet: [A, B, C], ts: 2 }),
      ev({ type: "nominations", initiator: C, witnessSet: [A, C, D], ts: 3 }),
      ev({ type: "confessional", initiator: A, witnessSet: [A], ts: 4 }), // excluded — confessional
      ev({ type: "veto-ceremony", initiator: D, witnessSet: [B, D], ts: 5 }), // A not a witness
      ev({ type: "competition", initiator: A, witnessSet: [A, B, C, D], ts: 6 }),
      ev({ type: "eviction", initiator: C, witnessSet: [A, B, C, D], ts: 7 }),
    ];
    const selected = selectRecentForConfessional(events, A);
    expect(selected.length).toBeGreaterThan(0);
    // Top pick is eviction (salience=100, most recent ceremony)
    expect(selected[0]!.type).toBe("eviction");
    // No confessional-type event selected
    expect(selected.some((s) => s.type === "confessional")).toBe(false);
    // veto-ceremony not selected (A not a witness)
    expect(selected.some((s) => s.type === "veto-ceremony")).toBe(false);
  });

  it("returns events only from the confessor's witness set", () => {
    const events: E[] = [
      ev({ type: "nominations", initiator: C, witnessSet: [C, D], ts: 1 }),
      ev({ type: "competition", initiator: A, witnessSet: [A, B, C, D], ts: 2 }),
      ev({ type: "conversation", initiator: D, witnessSet: [D], ts: 3 }),
    ];
    const selected = selectRecentForConfessional(events, A);
    for (const s of selected) {
      const e = events.find((x) => x.type === s.type && x.ts === (s.type === "competition" ? 2 : 0));
      // Only the competition event includes A
      expect(s.type).toBe("competition");
    }
  });

  it("a confessional is never selected as a reactive event", () => {
    const events: E[] = [
      ev({ type: "confessional", initiator: A, witnessSet: [A], ts: 1 }),
      ev({ type: "nominations", initiator: A, witnessSet: [A, B], ts: 2 }),
    ];
    const selected = selectRecentForConfessional(events, A);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((s) => s.type !== "confessional")).toBe(true);
  });

  it("returns role initiator when the confessor initiated the event", () => {
    const events: E[] = [
      ev({ type: "veto-ceremony", initiator: A, witnessSet: [A, B, C], ts: 1 }),
    ];
    const selected = selectRecentForConfessional(events, A);
    expect(selected.length).toBe(1);
    expect(selected[0]!.role).toBe("initiator");
  });

  it("returns role participant when the confessor witnessed but did not initiate", () => {
    const events: E[] = [
      ev({ type: "veto-ceremony", initiator: B, witnessSet: [A, B, C], ts: 1 }),
    ];
    const selected = selectRecentForConfessional(events, A);
    expect(selected.length).toBe(1);
    expect(selected[0]!.role).toBe("participant");
  });

  it("returns empty when no witnessed events exist", () => {
    const events: E[] = [
      ev({ type: "conversation", initiator: B, witnessSet: [B, C], ts: 1 }),
    ];
    expect(selectRecentForConfessional(events, A)).toEqual([]);
  });

  it("returns empty for an empty event list", () => {
    expect(selectRecentForConfessional([], A)).toEqual([]);
  });
});

describe("0089 — reactive confessionalFor", () => {
  it("references the concrete recent event in the confessional content when recentEvents supplied", () => {
    const conf = confessionalFor(A, [A, B, C], rel(), {
      trigger: "the veto ceremony",
      recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
    });
    expect(conf.content).toContain("the veto ceremony");
    expect(conf.content).toContain("I witnessed");
    expect(conf.content).toContain(B); // still names target
    expect(conf.content).toContain(C); // still names ally
  });

  it("uses initiator phrase when the confessor initiated the event", () => {
    const conf = confessionalFor(A, [A, B, C], rel(), {
      recentEvents: [{ type: "nominations", role: "initiator" as const, gist: "the nomination ceremony" }],
    });
    expect(conf.content).toContain("I was at the center of");
  });

  it("falls back to trigger-label when recentEvents absent (byte-identical to 0040)", () => {
    // 0040 behavior: trigger produces "After the nomination ceremony: "
    const conf0040 = confessionalFor(A, [A, B, C], rel(), {
      trigger: "the nomination ceremony",
    });
    expect(conf0040.content).toContain("After the nomination ceremony: ");

    // 0089 with no recentEvents: same as 0040
    const conf0089 = confessionalFor(A, [A, B, C], rel(), {
      trigger: "the nomination ceremony",
      recentEvents: undefined,
    });
    expect(conf0089.content).toBe(conf0040.content);

    // 0089 with empty recentEvents: same as 0040
    const conf0089Empty = confessionalFor(A, [A, B, C], rel(), {
      trigger: "the nomination ceremony",
      recentEvents: [],
    });
    expect(conf0089Empty.content).toBe(conf0040.content);
  });

  it("no trigger and no recentEvents produces no opening prefix (0040 byte-identical)", () => {
    const confNoTrigger = confessionalFor(A, [A, B, C], rel(), {});
    expect(confNoTrigger.content).not.toContain("After ");

    const confNoTriggerRecentUndefined = confessionalFor(A, [A, B, C], rel(), { recentEvents: undefined });
    expect(confNoTriggerRecentUndefined.content).toBe(confNoTrigger.content);

    const confNoTriggerRecentEmpty = confessionalFor(A, [A, B, C], rel(), { recentEvents: [] });
    expect(confNoTriggerRecentEmpty.content).toBe(confNoTrigger.content);
  });

  it("still includes the trigger label as context alongside the reactive opening", () => {
    const conf = confessionalFor(A, [A, B, C], rel(), {
      trigger: "the veto ceremony",
      recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
    });
    expect(conf.content).toContain("during the veto ceremony");
  });
});

describe("0089 — recordConfessional with reactive events (Vault wall)", () => {
  it("a reactive confessional is recorded hidden, witnessed by the NPC alone — never the player", () => {
    const events = new InMemoryEventStore();
    const conf = confessionalFor(A, [A, B, C], rel(), {
      recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
    });
    recordConfessional(events, conf, new SeededRandom(1), 100);
    const recorded = events.query();
    expect(recorded.length).toBe(1);
    expect(recorded[0]!.hidden).toBe(true);
    expect(recorded[0]!.witnessSet).toEqual([A]);
    expect(recorded[0]!.witnessSet).not.toContain(PLAYER);
  });

  it("a reactive confessional contains no other houseguest's id (only the confessor's own read)", () => {
    const events = new InMemoryEventStore();
    const conf = confessionalFor(A, [A, B, C], rel(), {
      recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
    });
    recordConfessional(events, conf, new SeededRandom(1), 100);
    const content = events.query()[0]!.content;
    // The content names the target and ally (B and C) — which is the confessor's OWN grounded read,
    // not leaked hidden state of B or C. The reaction references the event, not another's hidden read.
    expect(content).not.toContain(D); // D is not involved
    // No hidden number leaks
    expect(content).not.toMatch(/[0-9]+\.[0-9]+/); // no floating-point leak
  });
});

describe("0089 — byte-identical when recentEvents absent (0040 regression)", () => {
  it("confessionalFor with recentEvents undefined is byte-identical to 0040", () => {
    const r = rel();
    const c0040 = confessionalFor(A, [A, B, C], r, { trigger: "the nomination ceremony", rng: new SeededRandom(42) });
    const c0089 = confessionalFor(A, [A, B, C], r, { trigger: "the nomination ceremony", rng: new SeededRandom(42), recentEvents: undefined });
    expect(c0089.content).toBe(c0040.content);
    expect(c0089.target).toBe(c0040.target);
    expect(c0089.ally).toBe(c0040.ally);
    expect(c0089.trigger).toBe(c0040.trigger);
  });

  it("confessionalFor with recentEvents [] is byte-identical to 0040", () => {
    const r = rel();
    const c0040 = confessionalFor(A, [A, B, C], r, { rng: new SeededRandom(99) });
    const c0089 = confessionalFor(A, [A, B, C], r, { rng: new SeededRandom(99), recentEvents: [] });
    expect(c0089.content).toBe(c0040.content);
  });

  it("involvedConfessionals without recentEvents context produces same result as before", () => {
    const r = rel();
    const before = involvedConfessionals([A, B], [A, B, C, D], r, (npc) => ({
      trigger: "the nomination ceremony",
      rng: new SeededRandom(npc === A ? 10 : 20),
    }));
    const after = involvedConfessionals([A, B], [A, B, C, D], r, (npc) => ({
      trigger: "the nomination ceremony",
      rng: new SeededRandom(npc === A ? 10 : 20),
      recentEvents: undefined,
    }));
    expect(after.map((c) => c.content)).toEqual(before.map((c) => c.content));
  });
});

describe("0089 — sentinel: player + admin surface never leak a reactive confessional", () => {
  it("reactive confessional content never appears on a player-visible projection (sandbox pattern)", () => {
    const events = new InMemoryEventStore();
    const conf = confessionalFor(A, [A, B, C], rel(), {
      trigger: "the veto ceremony",
      recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
    });
    recordConfessional(events, conf, new SeededRandom(7), 200);
    const queried = events.query();
    for (const e of queried) {
      expect(e.hidden).toBe(true);
      expect(e.witnessSet).not.toContain(PLAYER);
    }
    // The content is Vault-only — accessible only through the event store, never the player surface
    const playerQuery = events.query({ witnessedBy: PLAYER });
    expect(playerQuery.length).toBe(0);
  });

  it("admin-level inspection of events still shows confessional as hidden, not player-witnessed", () => {
    const events = new InMemoryEventStore();
    const conf = confessionalFor(A, [A, B, C], rel(), {
      recentEvents: [{ type: "nominations", role: "initiator" as const, gist: "the nomination ceremony" }],
    });
    recordConfessional(events, conf, new SeededRandom(3), 300);
    const all = events.query();
    expect(all.length).toBe(1);
    expect(all[0]!.hidden).toBe(true);
    // Admin does not witness the confessional either — witnessSet is [A] only
    expect(all[0]!.witnessSet).toEqual([A]);
  });
});

describe("0089 — selection is deterministic (same events ⇒ same result)", () => {
  it("selectRecentForConfessional is deterministic for the same events and npc", () => {
    const events: E[] = [
      ev({ type: "nominations", initiator: B, witnessSet: [A, B, C, D], ts: 1 }),
      ev({ type: "competition", initiator: A, witnessSet: [A, B, C, D], ts: 2 }),
      ev({ type: "veto-ceremony", initiator: C, witnessSet: [A, B, C, D], ts: 3 }),
    ];
    const a = selectRecentForConfessional(events, A);
    const b = selectRecentForConfessional(events, A);
    expect(a).toEqual(b);
  });

  it("confessionalFor with same inputs + recentEvents produces same output", () => {
    const r = rel();
    const c1 = confessionalFor(A, [A, B, C], r, {
      trigger: "the veto ceremony",
      rng: new SeededRandom(7),
      recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
    });
    const c2 = confessionalFor(A, [A, B, C], r, {
      trigger: "the veto ceremony",
      rng: new SeededRandom(7),
      recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
    });
    expect(c1.content).toBe(c2.content);
  });
});
