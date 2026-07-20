import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { BASE_GAME_MASTER_PROMPT } from "../../src/engine/momentPrompts";
import type { NamedRef } from "../../src/ports/GameSession";

/**
 * Feature 0106 — whole-house EVENTS (competitions + nomination/veto/eviction ceremonies) are EXCLUSIVE
 * set-pieces. Roles only (the player, the outgoing HOH, competitors, spectators). The event gathers the
 * whole house; for a comp the projection reports who plays vs watches (the outgoing HOH among the
 * spectators); there are no side rooms and the player can't wander off until it resolves. A pure
 * read-projection over the live state ⇒ the seeded sim is never touched.
 */

interface LivePoke {
  active: string[];
  outgoingHoh?: string;
  pending?: { kind: string; by: string; comp?: string };
  vetoField?: string[];
  competition?: unknown;
}

function started(seed: number): { s: GameSessionAdapter; playerId: string; npcs: string[]; live: LivePoke } {
  const s = new GameSessionAdapter();
  s.createCharacter({ playerName: "The Player", seed });
  const snap = s.snapshot();
  const playerId = snap.house!.player.id;
  const npcs = snap.house!.npcs.map((n) => n.id);
  const live = (s as unknown as { live: LivePoke }).live;
  // 0111: these tests poke a mid-game comp/ceremony pending directly — clear the premiere's gathered
  // champagne-circle flag so `houseEventInSession` reports the poked event, not the (higher-priority)
  // opening toast (which, in a real game, has closed long before any comp).
  (live as unknown as { champagneCircle?: string }).champagneCircle = undefined;
  return { s, playerId, npcs, live };
}
const ids = (rs: NamedRef[]): string[] => rs.map((r) => r.id);

describe("0106 — whole-house events are exclusive set-pieces", () => {
  it("during an HOH comp the whole house is gathered; the outgoing HOH spectates, not competes", () => {
    const { s, playerId, npcs, live } = started(2026);
    const outgoing = npcs[0]!;
    live.outgoingHoh = outgoing;
    live.pending = { kind: "comp-intent", by: playerId, comp: "hoh-competition" };

    const w = s.whereabouts()!;
    expect(w.houseEvent?.kind).toBe("hoh-competition");
    expect(w.nearby).toEqual([]); // no side rooms during an event
    const present = new Set(w.present.map((p) => p.id));
    for (const id of npcs) expect(present.has(id)).toBe(true); // the whole house is gathered
    expect(ids(w.houseEvent!.spectating!)).toContain(outgoing); // the outgoing HOH watches
    expect(ids(w.houseEvent!.competing!)).not.toContain(outgoing);
    expect(w.houseEvent!.youAreCompeting).toBe(true); // the player plays (not the outgoing HOH)
  });

  it("during a veto comp only the drawn six compete; the rest spectate", () => {
    const { s, playerId, npcs, live } = started(7);
    live.vetoField = [playerId, npcs[0]!, npcs[1]!, npcs[2]!, npcs[3]!, npcs[4]!]; // player + five drawn
    live.pending = { kind: "comp-intent", by: playerId, comp: "veto-competition" };

    const w = s.whereabouts()!;
    expect(w.houseEvent?.kind).toBe("veto-competition");
    expect(w.houseEvent!.youAreCompeting).toBe(true);
    const competing = new Set(ids(w.houseEvent!.competing!));
    for (const id of [npcs[0], npcs[1], npcs[2], npcs[3], npcs[4]]) expect(competing.has(id!)).toBe(true);
    expect(competing.has(npcs[6]!)).toBe(false); // a non-drawn houseguest
    expect(ids(w.houseEvent!.spectating!)).toContain(npcs[6]);
  });

  it("a CEREMONY also gathers the whole house (no competing split — everyone simply attends)", () => {
    const { s, playerId, npcs, live } = started(11);
    live.pending = { kind: "veto-decision", by: playerId };
    const w = s.whereabouts()!;
    expect(w.houseEvent?.kind).toBe("veto-ceremony");
    expect(w.houseEvent!.competing).toBeUndefined(); // a ceremony has no competitor split
    expect(w.nearby).toEqual([]);
    const present = new Set(w.present.map((p) => p.id));
    for (const id of npcs) expect(present.has(id)).toBe(true); // the whole house attends
  });

  it("the player cannot wander off mid-event — movePlayer is a no-op that keeps them gathered", () => {
    const { s, playerId, live } = started(3);
    live.pending = { kind: "eviction-vote", by: playerId };
    const before = s.whereabouts()!.room;
    const after = s.movePlayer("backyard")!;
    expect(after.room).toBe(before); // stayed gathered at the event
    expect(after.houseEvent?.kind).toBe("eviction");
  });

  it("with NO event in session there is no houseEvent block (normal whereabouts)", () => {
    const { s, live } = started(9);
    live.pending = undefined;
    live.competition = undefined;
    expect(s.whereabouts()!.houseEvent).toBeUndefined();
  });

  it("the narrator is told whole-house events are exclusive set-pieces that must not resume as if uninterrupted", () => {
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/WHOLE-HOUSE EVENTS ARE EXCLUSIVE/);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/outgoing HOH/);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/never resume|as if it never happened|not.*uninterrupted/i);
  });
});
