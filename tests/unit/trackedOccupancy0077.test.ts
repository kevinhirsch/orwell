import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { TRACKED_OCCUPANCY } from "../../src/engine/presenceConstants";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { Room, Occupancy } from "../../src/domain/house";
import type { GameHouse } from "../../src/engine/characterFactory";

/**
 * Feature 0077 Phase 2b — TRACKED OCCUPANCY & CONSPICUOUSNESS. Who is behind a CLOSED door is not an
 * ambient read (sightline makes those rooms opaque); it is knowledge the player EARNS by witnessing a
 * houseguest cross into a private room from a space they can see. The belief carries a pathway + age and
 * can go STALE; a private pair holed up a while emits a Vault-safe conspicuousness read. Roles only.
 */

interface Internals {
  house: GameHouse;
  presence: Occupancy | null;
  presenceTickCount: number;
  trackedOccupancy: Map<EntityId, { room: Room; asOfTick: number }> | null;
  noteWitnessedMovements(prev: Occupancy | null, next: Occupancy, playerRoom: Room | null): void;
}

function started(seed: number): { session: GameSessionAdapter; npcIds: EntityId[]; i: Internals } {
  const session = new GameSessionAdapter();
  session.createCharacter({ playerName: "The Player", seed });
  const i = session as unknown as Internals;
  i.trackedOccupancy = null;
  i.presenceTickCount = 0;
  return { session, npcIds: i.house.npcs.map((n) => n.id), i };
}

/** Apply one observed presence transition: bump the tick, fold witnessed movement, seat the new map. */
function observe(i: Internals, prev: Occupancy | null, next: Occupancy): void {
  i.presenceTickCount += 1;
  i.noteWitnessedMovements(prev ?? null, next, next.get(PLAYER) ?? null);
  i.presence = next;
}

const seat = (entries: Array<[EntityId, Room]>): Occupancy => new Map(entries);

describe("0077 tracked occupancy — earned by witnessing a crossing", () => {
  it("records a belief when the player watches a houseguest cross into a closed room", () => {
    const { session, npcIds, i } = started(31);
    const [npc] = npcIds;
    // Player in the living room (sees the hallway mouth); the houseguest steps hallway → bedroom-a.
    const prev = seat([[PLAYER, "living-room"], [npc!, "hallway"]]);
    const next = seat([[PLAYER, "living-room"], [npc!, "bedroom-a"]]);
    observe(i, prev, next);

    const w = session.whereabouts()!;
    expect(w.tracked).toHaveLength(1);
    expect(w.tracked![0]).toMatchObject({ id: npc, room: "bedroom-a", stale: false });
  });

  it("records NOTHING when the crossing happens out of the player's sight", () => {
    const { session, npcIds, i } = started(32);
    const [npc] = npcIds;
    // Player in the KITCHEN — no sightline to the hallway — so the entry is unwitnessed.
    const prev = seat([[PLAYER, "kitchen"], [npc!, "hallway"]]);
    const next = seat([[PLAYER, "kitchen"], [npc!, "bedroom-a"]]);
    observe(i, prev, next);

    expect(session.whereabouts()!.tracked).toBeUndefined();
  });

  it("a belief PERSISTS after the subject leaves unwitnessed, and decays to STALE", () => {
    const { session, npcIds, i } = started(33);
    const [npc] = npcIds;
    // Witness the entry from the living room.
    observe(i, seat([[PLAYER, "living-room"], [npc!, "hallway"]]), seat([[PLAYER, "living-room"], [npc!, "bedroom-a"]]));
    expect(session.whereabouts()!.tracked![0]).toMatchObject({ stale: false });

    // The player walks off to the kitchen; the houseguest slips out to the hallway UNWITNESSED (kitchen
    // can't see the hallway), then loiters there. The belief is never refreshed nor cleared — it just ages.
    let prev = seat([[PLAYER, "kitchen"], [npc!, "bedroom-a"]]);
    for (let k = 0; k < TRACKED_OCCUPANCY.staleTicks + 1; k++) {
      const next = seat([[PLAYER, "kitchen"], [npc!, "hallway"]]);
      observe(i, prev, next);
      prev = next;
    }
    const w = session.whereabouts()!;
    expect(w.tracked).toHaveLength(1); // still believed to be where they were last seen…
    expect(w.tracked![0]).toMatchObject({ id: npc, room: "bedroom-a", stale: true }); // …but no longer certain
  });

  it("CLEARS the belief the moment the player sees the houseguest in the open again", () => {
    const { session, npcIds, i } = started(34);
    const [npc] = npcIds;
    observe(i, seat([[PLAYER, "living-room"], [npc!, "hallway"]]), seat([[PLAYER, "living-room"], [npc!, "bedroom-a"]]));
    expect(session.whereabouts()!.tracked).toHaveLength(1);
    // They step back into the hallway while the player (still in the living room) is watching it.
    observe(i, seat([[PLAYER, "living-room"], [npc!, "bedroom-a"]]), seat([[PLAYER, "living-room"], [npc!, "hallway"]]));
    expect(session.whereabouts()!.tracked).toBeUndefined();
  });

  it("a live sighting suppresses any lingering belief (the read never contradicts itself)", () => {
    const { session, npcIds, i } = started(35);
    const [npc] = npcIds;
    // Manually hold a belief, then seat the same houseguest where the player can SEE them (the hallway,
    // visible from the living room). The live presence must win — no tracked entry for someone in view.
    i.trackedOccupancy = new Map([[npc!, { room: "bedroom-a", asOfTick: 1 }]]);
    i.presenceTickCount = 2;
    i.presence = seat([[PLAYER, "living-room"], [npc!, "hallway"]]);
    const w = session.whereabouts()!;
    expect(w.nearby.flatMap((n) => n.present).map((p) => p.id)).toContain(npc);
    expect(w.tracked).toBeUndefined();
  });
});

describe("0077 conspicuousness — two alone too long", () => {
  function pairHoledUp(seed: number): { session: GameSessionAdapter; a: EntityId; b: EntityId; i: Internals } {
    const { session, npcIds, i } = started(seed);
    const [a, b] = npcIds;
    // Both cross hallway → bedroom-c while the player watches from the living room.
    observe(i,
      seat([[PLAYER, "living-room"], [a!, "hallway"], [b!, "hallway"]]),
      seat([[PLAYER, "living-room"], [a!, "bedroom-c"], [b!, "bedroom-c"]]));
    // The player wanders to the kitchen; the pair stays put, unwitnessed, while time passes.
    let prev = seat([[PLAYER, "living-room"], [a!, "bedroom-c"], [b!, "bedroom-c"]]);
    for (let k = 0; k < TRACKED_OCCUPANCY.conspicuousMinTicks; k++) {
      const next = seat([[PLAYER, "kitchen"], [a!, "bedroom-c"], [b!, "bedroom-c"]]);
      observe(i, prev, next);
      prev = next;
    }
    return { session, a: a!, b: b!, i };
  }

  it("trips for exactly a PAIR who went in a while ago and never came out", () => {
    const { session, a, b } = pairHoledUp(41);
    const w = session.whereabouts()!;
    expect(w.conspicuous).toHaveLength(1);
    expect(w.conspicuous![0].room).toBe("bedroom-c");
    expect(w.conspicuous![0].who.map((p) => p.id).sort()).toEqual([a, b].sort());
    expect(w.conspicuous![0].sinceTicks).toBeGreaterThanOrEqual(TRACKED_OCCUPANCY.conspicuousMinTicks);
  });

  it("does NOT trip for a lone houseguest, nor on a fresh sighting", () => {
    const { session, npcIds, i } = started(42);
    const [a, b] = npcIds;
    // A solo entry — never conspicuous however long it ages.
    let prev = seat([[PLAYER, "living-room"], [a!, "hallway"]]);
    for (let k = 0; k < TRACKED_OCCUPANCY.conspicuousMinTicks + 2; k++) {
      const next = seat([[PLAYER, k === 0 ? "living-room" : "kitchen"], [a!, k === 0 ? "bedroom-c" : "bedroom-c"]]);
      observe(i, prev, next);
      prev = next;
    }
    expect(session.whereabouts()!.conspicuous).toBeUndefined();

    // A fresh PAIR sighting (sinceTicks 0) is below the threshold — a meeting, not yet conspicuous.
    const fresh = started(43);
    observe(fresh.i,
      seat([[PLAYER, "living-room"], [fresh.npcIds[0]!, "hallway"], [fresh.npcIds[1]!, "hallway"]]),
      seat([[PLAYER, "living-room"], [fresh.npcIds[0]!, "bedroom-c"], [fresh.npcIds[1]!, "bedroom-c"]]));
    expect(fresh.session.whereabouts()!.conspicuous).toBeUndefined();
  });
});

describe("0077 tracked occupancy — Vault-safe & durable", () => {
  it("the whereabouts read carries who/where/how-long only — never sealed scene content", () => {
    const { session, npcIds, i } = started(51);
    const [a, b] = npcIds;
    // Plant a sentinel into hidden state; the conspicuousness read must never carry it.
    const core = session.snapshot();
    const SENTINEL = "SENTINEL-0077-tracked-occupancy";
    core.house!.npcs[0]!.character.hiddenElements.push({ kind: "secret-motive", detail: SENTINEL });
    session.restore(core);
    const j = session as unknown as Internals;
    j.trackedOccupancy = null; j.presenceTickCount = 0;

    observe(i,
      seat([[PLAYER, "living-room"], [a!, "hallway"], [b!, "hallway"]]),
      seat([[PLAYER, "living-room"], [a!, "bedroom-c"], [b!, "bedroom-c"]]));
    for (let k = 0; k < TRACKED_OCCUPANCY.conspicuousMinTicks; k++) {
      observe(i, i.presence!, seat([[PLAYER, "kitchen"], [a!, "bedroom-c"], [b!, "bedroom-c"]]));
    }
    const blob = JSON.stringify(session.whereabouts());
    expect(blob).not.toContain(SENTINEL);
    expect(blob).not.toMatch(/secret-motive/);
    // Strict shape: a tracked entry is exactly {id,name,room,asOf,stale}.
    for (const t of session.whereabouts()!.tracked ?? []) {
      expect(Object.keys(t).sort()).toEqual(["asOf", "id", "name", "room", "stale"]);
    }
  });

  it("beliefs survive a snapshot/restore round-trip (acquired knowledge is durable)", () => {
    const { session, npcIds, i } = started(52);
    const [npc] = npcIds;
    observe(i, seat([[PLAYER, "living-room"], [npc!, "hallway"]]), seat([[PLAYER, "living-room"], [npc!, "bedroom-a"]]));
    const before = session.whereabouts()!.tracked;

    const revived = new GameSessionAdapter();
    revived.restore(session.snapshot());
    expect(revived.whereabouts()!.tracked).toEqual(before);
  });
});
