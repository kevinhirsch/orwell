import { describe, it, expect } from "vitest";
import { HOUSE_ROOMS, HOUSE_ADJACENCY, areAdjacent, occupancyViolations } from "../../src/domain/house";
import type { Room } from "../../src/domain/house";
import { assignRooms, rollOverhears } from "../../src/engine/presence";
import { PRESENCE } from "../../src/engine/presenceConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0049 / B64 — house presence & lingering play. Roles only — no fixture names.
 */

// --- the floor plan (pure domain data) -------------------------------------------

describe("the house floor plan (0049)", () => {
  it("adjacency is symmetric, irreflexive, and covers every room", () => {
    for (const room of HOUSE_ROOMS) {
      const adj = HOUSE_ADJACENCY.get(room);
      expect(adj, `${room} has an adjacency entry`).toBeDefined();
      expect(adj).not.toContain(room);
      for (const other of adj!) {
        expect(HOUSE_ADJACENCY.get(other), `${other} ↔ ${room} is symmetric`).toContain(room);
      }
    }
  });

  it("every room is reachable from every other (the house is connected)", () => {
    const seen = new Set<Room>([HOUSE_ROOMS[0]!]);
    const queue: Room[] = [HOUSE_ROOMS[0]!];
    while (queue.length > 0) {
      for (const next of HOUSE_ADJACENCY.get(queue.pop()!) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    expect(seen.size).toBe(HOUSE_ROOMS.length);
  });

  it("the diary room adjoins ONLY the living room — overhearing it is impossible by data", () => {
    expect(HOUSE_ADJACENCY.get("diary-room")).toEqual(["living-room"]);
  });
});

// --- seeded occupancy (engine) ----------------------------------------------------

const cast = (n: number): EntityId[] => [PLAYER, ...Array.from({ length: n }, (_, i) => npc(i + 1))];
const flatAffinity = () => 0.5;

describe("seeded room assignment (0049)", () => {
  it("one room per active houseguest, adjacent moves only, across many ticks", () => {
    const active = cast(15);
    const rng = new SeededRandom(7);
    let occ = assignRooms(active, null, { rng, affinity: flatAffinity });
    expect(occupancyViolations(active, occ)).toEqual([]);
    for (let tick = 0; tick < 60; tick++) {
      const next = assignRooms(active, occ, { rng, affinity: flatAffinity });
      expect(occupancyViolations(active, next, occ)).toEqual([]);
      occ = next;
    }
  });

  it("same seed ⇒ identical trajectories; different seeds diverge", () => {
    const active = cast(15);
    const run = (seed: number): string => {
      const rng = new SeededRandom(seed);
      let occ = assignRooms(active, null, { rng, affinity: flatAffinity });
      const trail: string[] = [];
      for (let t = 0; t < 20; t++) {
        occ = assignRooms(active, occ, { rng, affinity: flatAffinity });
        trail.push([...occ.entries()].map(([id, r]) => `${id}@${r}`).join(","));
      }
      return trail.join("|");
    };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });

  it("nobody hangs out in the diary room (it is a booth, not a lounge)", () => {
    const active = cast(15);
    const rng = new SeededRandom(3);
    let occ = assignRooms(active, null, { rng, affinity: flatAffinity });
    for (let t = 0; t < 40; t++) {
      occ = assignRooms(active, occ, { rng, affinity: flatAffinity });
      for (const room of occ.values()) expect(room).not.toBe("diary-room");
    }
  });
});

// --- overhearing (gated, partial, traceable) ---------------------------------------

function overhearFixture() {
  const events = new InMemoryEventStore();
  const knowledge = new InMemoryKnowledgeService(events);
  const record = (id: string, content: string, witnesses: EntityId[]) =>
    events.record({ id, ts: 1, type: "conversation", initiator: witnesses[0]!, witnessSet: witnesses, hidden: !witnesses.includes(PLAYER), content });
  return { events, knowledge, record };
}

describe("adjacency overhears (0049)", () => {
  it("participants never overhear; non-adjacent rooms never overhear; adjacent rooms are gated", () => {
    const { knowledge, record } = overhearFixture();
    const content = "two houseguests plot the week's votes in detail";
    record("scene:1", content, [npc(1), npc(2)]);
    let hearers = 0;
    const samples = 400;
    for (let i = 0; i < samples; i++) {
      const occupancy = new Map<EntityId, Room>([
        [npc(1), "kitchen"], [npc(2), "kitchen"],      // the scene
        [npc(3), "living-room"],                        // adjacent — may overhear
        [npc(4), "bedroom-a"],                          // NOT adjacent to the kitchen — never
      ]);
      const heard = rollOverhears({
        eventId: "scene:1", room: "kitchen", content, participants: [npc(1), npc(2)],
        occupancy, knowledge, rng: new SeededRandom(1000 + i),
      });
      expect(heard).not.toContain(npc(1));
      expect(heard).not.toContain(npc(2));
      expect(heard).not.toContain(npc(4));
      if (heard.includes(npc(3))) hearers++;
    }
    // Gated, never guaranteed: a real but bounded (rare — an overhear is special) fraction succeeds.
    expect(hearers).toBeGreaterThan(samples * 0.02);
    expect(hearers).toBeLessThan(samples * 0.3);
    // The non-adjacent houseguest still knows nothing (no presence-derived pathway ⇒ no knowledge).
    expect(knowledge.knownTo(npc(4))).toEqual([]);
  });

  it("a successful overhear is partial, lower-confidence, and traceable to its event", () => {
    const { knowledge, record } = overhearFixture();
    const content = "the schemer and the ally agree to blindside the head of household on eviction night";
    record("scene:2", content, [npc(1), npc(2)]);
    const occupancy = new Map<EntityId, Room>([
      [npc(1), "kitchen"], [npc(2), "kitchen"], [PLAYER, "living-room"],
    ]);
    // Find a seed where the roll succeeds (gated — not every seed hears).
    let heard: EntityId[] = [];
    for (let s = 0; s < 50 && heard.length === 0; s++) {
      heard = rollOverhears({
        eventId: "scene:2", room: "kitchen", content, participants: [npc(1), npc(2)],
        occupancy, knowledge, rng: new SeededRandom(s),
      });
    }
    expect(heard).toEqual([PLAYER]);
    const fact = knowledge.knownTo(PLAYER).find((f) => f.pathway === "overheard:scene:2");
    expect(fact).toBeDefined();
    // Partial by construction: they caught a fragment, never the verbatim line.
    expect(fact!.content).not.toContain(content);
    expect(fact!.content).toContain("overheard");
    // Lower confidence than a witness (witnessed facts carry no reduced-confidence marker).
    expect(fact!.confidence).toBe(PRESENCE.overhearConfidence);
    expect(fact!.confidence!).toBeLessThan(1);
    // Traceable: the pathway names the recorded event, and the surfacing was recorded as an event.
    expect(fact!.sourceEventId).toBeDefined();
  });

  it("an unanchored overheard pathway is downgraded to suspicion (0002 unchanged)", () => {
    const { knowledge } = overhearFixture();
    const got = knowledge.surfaceInformationTo(npc(3), { content: "x", confidence: 0.4 }, "overheard:no-such-event");
    expect(got).toBeNull();
    expect(knowledge.knownTo(npc(3))).toEqual([]);
    expect(knowledge.suspicionsOf(npc(3)).length).toBe(1);
  });
});

// --- the live game: whereabouts, witnesses, lingering ------------------------------

function liveGame(seed: number) {
  const reg = new GameSessionRegistry();
  const user = `presence-u${seed}`;
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, user, sb };
}

describe("whereabouts (0049) — the Vault-free presence read", () => {
  it("is null before a game starts and grounded after", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("presence-pre");
    expect(sb.session.whereabouts()).toBeNull();
    sb.session.createCharacter({ playerName: "The Player", seed: 4 });
    const w = sb.session.whereabouts();
    expect(w).not.toBeNull();
    expect(HOUSE_ROOMS).toContain(w!.room as Room);
  });

  it("shows only the player's room + adjacent rooms, names only — no numbers, motives, or hidden keys", () => {
    const { sb } = liveGame(8);
    const w = sb.session.whereabouts()!;
    const adjacent = HOUSE_ADJACENCY.get(w.room as Room) ?? [];
    expect(w.nearby.map((n) => n.room)).toEqual([...adjacent]);
    for (const n of w.nearby) expect(areAdjacent(w.room as Room, n.room as Room)).toBe(true);
    // Strict shape: NamedRefs only in present/nearby (no numbers, motives, or hidden keys).
    for (const ref of [...w.present, ...w.nearby.flatMap((n) => n.present)]) {
      expect(Object.keys(ref).sort()).toEqual(["id", "name"]);
    }
    // L21/L24: duration rides the view — the player's tenure + each companion's (a NamedRef + turnsHere).
    expect(Object.keys(w).sort()).toEqual(["companions", "nearby", "present", "room", "turnsHere"]);
    expect(typeof w.turnsHere).toBe("number");
    expect(w.turnsHere).toBeGreaterThanOrEqual(0);
    expect(w.companions.map((c) => c.id).sort()).toEqual(w.present.map((p) => p.id).sort()); // same people as present
    for (const c of w.companions) {
      expect(Object.keys(c).sort()).toEqual(["id", "name", "turnsHere"]);
      expect(c.turnsHere).toBeGreaterThanOrEqual(0);
    }
    // Non-adjacent rooms never appear (fog of war): rooms shown = own + adjacent.
    const shown = new Set([w.room, ...w.nearby.map((n) => n.room)]);
    for (const room of shown) expect(HOUSE_ROOMS).toContain(room as Room);
    expect(shown.size).toBe(adjacent.length + 1);
  });

  it("L21/L24 — the player is a person: held across engine ticks, relocated only by movePlayer; tenure accrues", () => {
    const { sb } = liveGame(8);
    const room0 = sb.session.whereabouts()!.room;
    // The engine drives many off-screen ticks (NPCs move) — the player is NEVER auto-relocated.
    for (let i = 0; i < 12; i++) sb.session.presenceTick(new SeededRandom(500 + i));
    expect(sb.session.whereabouts()!.room).toBe(room0);
    expect(sb.session.whereabouts()!.turnsHere).toBeGreaterThan(0); // tenure accrued while held
    // A DIRECTED move relocates the player and resets their tenure (a fresh arrival).
    const dest = HOUSE_ROOMS.find((r) => r !== room0 && r !== "diary-room")!;
    const after = sb.session.movePlayer(dest)!;
    expect(after.room).toBe(dest);
    expect(after.turnsHere).toBe(0);
    // The engine still doesn't yank them off their chosen room on subsequent ticks.
    for (let i = 0; i < 6; i++) sb.session.presenceTick(new SeededRandom(900 + i));
    expect(sb.session.whereabouts()!.room).toBe(dest);
    // An unknown room is a no-op (stays put); a same-room move is idempotent.
    expect(sb.session.movePlayer("nowhere-room")!.room).toBe(dest);
  });

  it("L21/L24 — presence tenure round-trips through a save (continuity survives a restart)", () => {
    const { sb } = liveGame(5);
    for (let i = 0; i < 4; i++) sb.session.presenceTick(new SeededRandom(70 + i));
    const before = sb.session.whereabouts()!;
    const core = sb.session.snapshot();
    sb.session.restore(core);
    const restored = sb.session.whereabouts()!;
    expect(restored.room).toBe(before.room);
    expect(restored.turnsHere).toBe(before.turnsHere); // duration is durable, not reseeded to 0
  });

  it("never leaks a planted hidden sentinel", () => {
    const { sb } = liveGame(13);
    const sentinel = "SENTINEL-0049-whereabouts";
    const core = sb.session.snapshot();
    core.house!.npcs[0]!.character.hiddenElements.push({ kind: "secret-motive", detail: sentinel });
    core.house!.npcs[0]!.soul.memory.push(sentinel);
    sb.session.restore(core);
    expect(JSON.stringify(sb.session.whereabouts())).not.toContain(sentinel);
  });

  it("presence survives a snapshot/restore round-trip (the snapshot is the contract)", () => {
    const { reg, user, sb } = liveGame(21);
    const before = JSON.stringify(sb.session.whereabouts());
    const snap = reg.snapshot(user);
    const reg2 = new GameSessionRegistry();
    reg2.restore(user, snap);
    expect(JSON.stringify(reg2.sandboxFor(user).session.whereabouts())).toBe(before);
  });
});

describe("presence in the live loop (0049)", () => {
  it("co-presence makes a witness: a recorded scene picks up the room's occupants", () => {
    const { sb } = liveGame(5);
    // Steer occupancy directly through the provider seam: player + two NPCs share a room.
    const occupancy = new Map<EntityId, Room>([
      [PLAYER, "backyard"], [npc(1), "backyard"], [npc(2), "backyard"], [npc(3), "hoh-room"],
    ]);
    sb.commands.setPresenceProvider(() => occupancy);
    const { eventId } = sb.commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "a quiet talk by the pool",
    });
    const ev = sb.engine.events.query().find((e) => e.id === eventId)!;
    expect(ev.witnessSet).toContain(npc(2));       // in the room ⇒ a witness
    expect(ev.witnessSet).not.toContain(npc(3));   // not in the room (hoh-room is not adjacent grounds for witnessing)
    expect(ev.hidden).toBe(false);                  // the player witnessed it — never secret (0002)
  });

  it("an NPC next door can overhear the player (gated), via a traceable pathway", () => {
    const { sb } = liveGame(6);
    const occupancy = new Map<EntityId, Room>([
      [PLAYER, "kitchen"], [npc(1), "kitchen"], [npc(2), "living-room"],
    ]);
    sb.commands.setPresenceProvider(() => occupancy);
    // Roll many scenes; the gate means SOME (not all) are overheard.
    let overheard = 0;
    const scenes = 120;
    for (let i = 0; i < scenes; i++) {
      const { eventId } = sb.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: `the player confides plan number ${i}`,
      });
      if (sb.engine.knowledge.knownTo(npc(2)).some((f) => f.pathway === `overheard:${eventId}`)) overheard++;
    }
    expect(overheard).toBeGreaterThan(0);
    expect(overheard).toBeLessThan(scenes);
  });

  it("the off-screen tick seats the house and can surface an overheard NPC scene to the player", () => {
    // Across seeds, the orchestrator's off-screen ticks must eventually generate a player
    // overhear of a hidden NPC scene — the v1 flagship beat, now legal — without ever leaking
    // the verbatim hidden content (the integrity checkpoint stays green throughout).
    let sawPlayerOverhear = false;
    for (const seed of [1, 2, 3]) {
      const { reg, user, sb } = liveGame(seed);
      const orch = new Orchestrator(reg, { now: () => 1000 }, { seed });
      for (let t = 0; t < 80 && !sawPlayerOverhear; t++) {
        const res = orch.advance(user, "offscreen-tick");
        expect(res.integrity).toBe("ok");
        sawPlayerOverhear = sb.engine.knowledge
          .knownTo(PLAYER)
          .some((f) => f.pathway.startsWith("overheard:offscreen:"));
      }
      // The tick keeps the one-room invariant against the live roster.
      const core = sb.session.snapshot();
      const evicted = new Set(core.live?.evictionOrder ?? []);
      const active = [core.house!.player.id, ...core.house!.npcs.map((n) => n.id)].filter((id) => !evicted.has(id));
      expect(occupancyViolations(active, sb.session.occupancy()!)).toEqual([]);
      if (sawPlayerOverhear) break;
    }
    expect(sawPlayerOverhear, "the player eventually overhears an off-screen scene").toBe(true);
  });

  it("an overheard hidden scene reaches the player only as a fragment — never verbatim", () => {
    const { reg, user, sb } = liveGame(9);
    const orch = new Orchestrator(reg, { now: () => 1 }, { seed: 9 });
    for (let t = 0; t < 40; t++) expect(orch.advance(user, "offscreen-tick").integrity).toBe("ok");
    const hidden = sb.engine.events.query().filter((e) => e.hidden).map((e) => e.content);
    for (const f of sb.engine.knowledge.knownTo(PLAYER)) {
      for (const h of hidden) expect(f.content.includes(h), "a verbatim hidden content crossed").toBe(false);
    }
  });

  it("evicted houseguests occupy no room across a driven season", () => {
    const { sb } = liveGame(2);
    const s = sb.session;
    for (let i = 0; i < 600; i++) {
      const v = s.advanceGame();
      if (v.pending) {
        const p = v.pending;
        if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
        else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
        else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
        else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
        else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
      }
      const core = s.snapshot();
      const evicted = new Set(core.live?.evictionOrder ?? []);
      const occ = s.occupancy();
      if (occ) for (const id of occ.keys()) expect(evicted.has(id), `${id} evicted but seated`).toBe(false);
      if (v.finished) break;
    }
  });
});

describe("lingering never advances the week (0049 / ADR 0003 §7)", () => {
  it("many mill/talk turns leave week, phase, and the pending decision untouched — and count as activity", () => {
    const { reg, user, sb } = liveGame(17);
    let t = 1000;
    const orch = new Orchestrator(reg, { now: () => t }, { seed: 17, turnDriven: true });
    reg.setCommit((u) => orch.commitPlayerTurn(u));
    const s = sb.session;

    // Reach a pending player decision mid-week (the loop blocks on it).
    let pending = s.advanceGame().pending;
    for (let i = 0; i < 200 && !pending; i++) pending = s.advanceGame().pending;
    expect(pending).not.toBeNull();
    const before = { week: s.gameStatus().week, phase: s.gameStatus().phase, kind: pending!.kind };
    expect(orch.idleSince(user)).not.toBe(Infinity); // the drive above already counted as activity

    // The player mills: reads whereabouts, talks, moves about — many consecutive turns.
    for (let i = 0; i < 20; i++) {
      t += 60_000;
      expect(s.whereabouts()).not.toBeNull();
      sb.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: `milling-about chat ${i}`, kind: "bonding",
      });
      const status = s.gameStatus();
      expect(status.week).toBe(before.week);
      expect(status.phase).toBe(before.phase);
      expect(s.advanceGame().pending?.kind).toBe(before.kind); // idempotent while pending — still the same beat
      expect(orch.idleSince(user)).toBe(t); // milling resets the idle clock: activity, not idleness
    }
  });
});
