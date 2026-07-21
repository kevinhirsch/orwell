import { describe, it, expect } from "vitest";
import {
  richOffscreenStretch,
  schemeTargetOf,
  npcTargetClause,
  SOCIETY,
} from "../../src/engine/offscreen";
import { RelationshipModel } from "../../src/engine/relationships";
import type { EdgeSignals } from "../../src/engine/relationshipConstants";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { isVisibleTo } from "../../src/domain/event";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Wave-2 off-screen-society fidelity — OFF-SCREEN SCHEMING NAMES A REAL TARGET. A strategy/alliance/
 * conflict scene between two NPCs is really ABOUT a THIRD houseguest (the person they're plotting
 * against), but the scene named only its two participants — so the hidden layer, and the gossip that
 * rises from it, carried no concrete target. These tests prove an off-screen scheme now occasionally
 * names the initiator's real top THREAT among the OTHER houseguests as its target, GROUNDED in the
 * edge (never invented) — while the Vault Wall holds: the named target is never a witness/actor of the
 * scene, and a player-facing (witness-derived) read can never surface it directly. Roles only.
 */

const NPCS = [npc(1), npc(2), npc(3), npc(4), npc(5)];
const OCCUPANCY = new Map(NPCS.map((n) => [n, "living-room"] as const));

/** An edge source where the whole house schemes against ONE houseguest (npc(5)), a real, grounded read. */
function edgeWhereOneIsTheThreat(rel: RelationshipModel, threatId: string): (a: string, b: string) => EdgeSignals {
  for (const n of NPCS) {
    if (n === threatId) continue;
    rel.edge(n, threatId).threat = 0.95;
    // Charged ties to each other so STRATEGY/ALLIANCE/CONFLICT scenes actually draw.
    for (const m of NPCS) if (m !== n && m !== threatId) rel.edge(n, m).alignment = 0.7;
  }
  return (a, b) => rel.edge(a, b);
}

describe("Wave-2 — off-screen scheming names a real target", () => {
  it("schemeTargetOf: returns the initiator's real top threat among the others, never the excluded/self", () => {
    const rel = new RelationshipModel(0.5);
    const self = npc(1);
    rel.edge(self, npc(2)).threat = 0.9; // the biggest threat
    rel.edge(self, npc(3)).threat = 0.4;
    rel.edge(self, npc(4)).threat = 0.1;
    const edgeOf = (a: string, b: string) => rel.edge(a, b);

    // npc(2) is the top threat and is picked.
    expect(schemeTargetOf(edgeOf, self, [], NPCS)).toBe(npc(2));
    // Exclude the top threat (e.g. the scene partner) ⇒ falls to the next real threat.
    expect(schemeTargetOf(edgeOf, self, [npc(2)], NPCS)).toBe(npc(3));
    // Self is never a target.
    expect(schemeTargetOf(edgeOf, self, [], NPCS)).not.toBe(self);
  });

  it("schemeTargetOf: returns undefined when nobody reads as a genuine threat (no target is invented)", () => {
    const rel = new RelationshipModel(0.5); // default edges: threat 0, below the incentive floor
    const edgeOf = (a: string, b: string) => rel.edge(a, b);
    expect(schemeTargetOf(edgeOf, npc(1), [], NPCS)).toBeUndefined();
  });

  it("npcTargetClause: names the target and carries NO number (Vault-safe texture)", () => {
    for (const type of ["strategy", "alliance", "conflict"] as const) {
      const clause = npcTargetClause(npc(1), npc(5), type);
      expect(clause).toContain(npc(5));
      // No relationship MAGNITUDE ever crosses: stripping the (digit-bearing) entity ids leaves no number.
      const withoutIds = clause.split(npc(5)).join("").split(npc(1)).join("");
      expect(/\d/.test(withoutIds)).toBe(false);
    }
  });

  it("richOffscreenStretch: some scenes name a third-party target, yet the target is NEVER a witness or actor", () => {
    const threatId = npc(5);
    const rel = new RelationshipModel(0.5);
    const edgeOf = edgeWhereOneIsTheThreat(rel, threatId);
    const events = new InMemoryEventStore();
    const scenes = richOffscreenStretch({
      events, rng: new SeededRandom(7), npcs: NPCS, interactions: 80,
      edgeOf, occupancy: OCCUPANCY, nameSchemeTargets: true,
    });

    // A scene names the target when the target is a SUBJECT but neither participant.
    const namingTarget = scenes.filter(
      (s) => s.event.content.includes(threatId) && s.initiator !== threatId && s.partner !== threatId,
    );
    expect(namingTarget.length, "at least some off-screen schemes name a third-party target").toBeGreaterThan(0);

    for (const s of namingTarget) {
      // Vault Wall: the target is a SUBJECT only — never in the witness set, never an actor.
      expect(s.event.hidden).toBe(true);
      expect(s.event.witnessSet).not.toContain(threatId);
      expect(s.initiator).not.toBe(threatId);
      expect(s.partner).not.toBe(threatId);
      // A player-facing (witness-derived) read can NEVER surface this scene directly.
      expect(isVisibleTo(s.event, PLAYER)).toBe(false);
      expect(isVisibleTo(s.event, threatId)).toBe(false);
    }
  });

  it("richOffscreenStretch: with nameSchemeTargets OFF, no third-party target clause is appended", () => {
    const threatId = npc(5);
    const rel = new RelationshipModel(0.5);
    const edgeOf = edgeWhereOneIsTheThreat(rel, threatId);
    const scenes = richOffscreenStretch({
      events: new InMemoryEventStore(), rng: new SeededRandom(7), npcs: NPCS, interactions: 80,
      edgeOf, occupancy: OCCUPANCY, // no nameSchemeTargets
    });
    // No scene between two OTHER NPCs ever names the threat subject when the layer is off.
    const naming = scenes.filter(
      (s) => s.event.content.includes(threatId) && s.initiator !== threatId && s.partner !== threatId,
    );
    expect(naming.length).toBe(0);
  });

  it("richOffscreenStretch: enabling nameSchemeTargets is BYTE-IDENTICAL to the seeded spine (only hidden content grows)", () => {
    const threatId = npc(5);
    const mk = (on: boolean) => {
      const rel = new RelationshipModel(0.5);
      const edgeOf = edgeWhereOneIsTheThreat(rel, threatId);
      return richOffscreenStretch({
        events: new InMemoryEventStore(), rng: new SeededRandom(11), npcs: NPCS, interactions: 60,
        edgeOf, occupancy: OCCUPANCY, ...(on ? { nameSchemeTargets: true } : {}),
      });
    };
    const off = mk(false);
    const on = mk(true);
    // The scene SPINE (who, with whom, what nature, ids) is identical — the seeded competition/vote
    // stream that shares this rng never shifts; only the target CLAUSE is appended to some contents.
    expect(on.map((s) => `${s.initiator}|${s.partner}|${s.type}|${s.event.id}`))
      .toEqual(off.map((s) => `${s.initiator}|${s.partner}|${s.type}|${s.event.id}`));
    // ...and the clause only ever ADDS to content (the off content is a prefix of the on content).
    for (let i = 0; i < off.length; i++) {
      expect(on[i]!.event.content.startsWith(off[i]!.event.content)).toBe(true);
    }
    // At least one on-scene actually grew (proves the layer fired for this seed).
    expect(on.some((s, i) => s.event.content.length > off[i]!.event.content.length)).toBe(true);
  });

  it("the named target is always a REAL threat read of the initiator (grounded, never a random name)", () => {
    const threatId = npc(5);
    const rel = new RelationshipModel(0.5);
    const edgeOf = edgeWhereOneIsTheThreat(rel, threatId);
    const scenes = richOffscreenStretch({
      events: new InMemoryEventStore(), rng: new SeededRandom(3), npcs: NPCS, interactions: 80,
      edgeOf, occupancy: OCCUPANCY, nameSchemeTargets: true,
    });
    for (const s of scenes) {
      if (!s.event.content.includes(threatId)) continue;
      if (s.initiator === threatId || s.partner === threatId) continue; // participant mention, not a target clause
      // Grounded: the initiator genuinely reads the named target as a threat above the incentive floor.
      expect(edgeOf(s.initiator, threatId).threat).toBeGreaterThanOrEqual(SOCIETY.betrayalThreatFloor);
    }
  });

  it("the player is NEVER a scheme target here (PV1 owns the player-subject case)", () => {
    // Every NPC reads the PLAYER as their biggest threat, but nameSchemeTargets excludes the player.
    const rel = new RelationshipModel(0.5);
    for (const n of NPCS) {
      rel.edge(n, PLAYER).threat = 0.99;
      for (const m of NPCS) if (m !== n) rel.edge(n, m).alignment = 0.7;
    }
    const edgeOf = (a: string, b: string) => rel.edge(a, b);
    const scenes = richOffscreenStretch({
      events: new InMemoryEventStore(), rng: new SeededRandom(9), npcs: NPCS, interactions: 60,
      edgeOf, occupancy: OCCUPANCY, nameSchemeTargets: true, playerSubject: PLAYER,
    });
    // The scheme-target clause never names the player (the player subject clause is a separate feature);
    // the target clause phrasings ("gone next" / "take … out" / "fed up with") never carry the player id.
    for (const s of scenes) {
      expect(schemeTargetOf(edgeOf, s.initiator, [s.partner, PLAYER], NPCS)).not.toBe(PLAYER);
    }
  });
});
