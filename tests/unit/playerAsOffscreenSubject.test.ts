import { describe, it, expect } from "vitest";
import { richOffscreenStretch } from "../../src/engine/offscreen";
import { confessionalFor, involvedConfessionals, recordConfessional } from "../../src/engine/confessionals";
import { RelationshipModel } from "../../src/engine/relationships";
import type { EdgeSignals } from "../../src/engine/relationshipConstants";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { isVisibleTo } from "../../src/domain/event";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * PV1 (#1029) — the player must NOT be structurally invisible to off-screen NPC cognition. Across a
 * full game the player appeared in the hidden layer exactly ONCE and was NEVER named as a
 * threat/ally/target in any confessional/whisper/strategy beat, though they rode to Final 2. These
 * tests prove an NPC can now name the PLAYER as the SUBJECT of an off-screen scene/confessional —
 * while the Vault Wall holds: the player is NEVER a witness/participant of those scenes, and a
 * player-facing read (witness-set-derived) can never surface them directly. Roles only.
 */

const NPCS = [npc(1), npc(2), npc(3), npc(4), npc(5)];
// All NPCs co-present so the motivated draw always has a partner.
const OCCUPANCY = new Map(NPCS.map((n) => [n, "living-room"] as const));

/** An edge source where every NPC reads the PLAYER as a strong threat (a real, grounded read). */
function edgeWherePlayerIsThreat(rel: RelationshipModel): (a: string, b: string) => EdgeSignals {
  for (const n of NPCS) {
    rel.edge(n, PLAYER).threat = 0.95;
    rel.edge(n, PLAYER).trust = 0.05;
    rel.edge(n, PLAYER).affinity = 0.05;
    // Give the NPCs a charged tie to each other too, so STRATEGY/CONFLICT scenes actually draw.
    for (const m of NPCS) if (m !== n) rel.edge(n, m).alignment = 0.7;
  }
  return (a, b) => rel.edge(a, b);
}

describe("PV1 (#1029) — the player as a SUBJECT of off-screen NPC cognition", () => {
  it("richOffscreenStretch: some scenes name the player as subject, yet the player is NEVER a witness or actor", () => {
    const rel = new RelationshipModel(0.5);
    const edgeOf = edgeWherePlayerIsThreat(rel);
    const events = new InMemoryEventStore();
    const scenes = richOffscreenStretch({
      events, rng: new SeededRandom(7), npcs: NPCS, interactions: 60,
      edgeOf, occupancy: OCCUPANCY, playerSubject: PLAYER,
    });

    const namingPlayer = scenes.filter((s) => s.event.content.includes(PLAYER));
    expect(namingPlayer.length, "at least some off-screen scenes name the player as a subject").toBeGreaterThan(0);

    for (const s of scenes) {
      // Vault Wall: the player is a SUBJECT only — never a witness, never an initiator/partner.
      expect(s.event.witnessSet).not.toContain(PLAYER);
      expect(s.event.hidden).toBe(true);
      expect(s.initiator).not.toBe(PLAYER);
      expect(s.partner).not.toBe(PLAYER);
      // A player-facing read is witness-set-derived: it can NEVER surface this scene directly.
      expect(isVisibleTo(s.event, PLAYER)).toBe(false);
    }
  });

  it("richOffscreenStretch: with NO playerSubject, the player is invisible to off-screen cognition (the main-branch behavior)", () => {
    const rel = new RelationshipModel(0.5);
    const edgeOf = edgeWherePlayerIsThreat(rel);
    const events = new InMemoryEventStore();
    const scenes = richOffscreenStretch({
      events, rng: new SeededRandom(7), npcs: NPCS, interactions: 60,
      edgeOf, occupancy: OCCUPANCY, // no playerSubject
    });
    expect(scenes.some((s) => s.event.content.includes(PLAYER))).toBe(false);
  });

  it("richOffscreenStretch: omitting playerSubject is BYTE-IDENTICAL (the seeded calibration spine is untouched)", () => {
    const mk = (player?: string) => {
      const rel = new RelationshipModel(0.5);
      const edgeOf = edgeWherePlayerIsThreat(rel);
      return richOffscreenStretch({
        events: new InMemoryEventStore(), rng: new SeededRandom(11), npcs: NPCS, interactions: 40,
        edgeOf, occupancy: OCCUPANCY, ...(player ? { playerSubject: player } : {}),
      });
    };
    const without = mk();
    const withSubject = mk(PLAYER);
    // The scene SPINE (who, with whom, what nature, ids) is identical — only the player-subject
    // CLAUSE is appended to some hidden contents. The seeded competition/vote stream never shifts.
    expect(withSubject.map((s) => `${s.initiator}|${s.partner}|${s.type}|${s.event.id}`))
      .toEqual(without.map((s) => `${s.initiator}|${s.partner}|${s.type}|${s.event.id}`));
    // ...and the player-bearing clause only ever ADDS to content (prefix preserved).
    for (let i = 0; i < without.length; i++) {
      expect(withSubject[i]!.event.content.startsWith(without[i]!.event.content)).toBe(true);
    }
  });

  it("confessionalFor: an NPC names the PLAYER as their target when the player is their real top threat", () => {
    const rel = new RelationshipModel(0.5);
    const self = npc(1);
    const others = [npc(2), npc(3)];
    // The player is the confessor's biggest threat; the NPC peers are lesser.
    rel.edge(self, PLAYER).threat = 0.95;
    rel.edge(self, npc(2)).threat = 0.2;
    rel.edge(self, npc(3)).threat = 0.1;

    const withPlayer = confessionalFor(self, others, rel, { player: PLAYER });
    expect(withPlayer.target).toBe(PLAYER); // grounded in the real edge, never invented
    expect(withPlayer.content).toContain(PLAYER);

    // Without the player as a candidate (the main-branch read), the player can NEVER be named.
    const withoutPlayer = confessionalFor(self, others, rel);
    expect(withoutPlayer.target).not.toBe(PLAYER);
    expect(withoutPlayer.content).not.toContain(PLAYER);
  });

  it("confessionalFor: an NPC names the PLAYER as their ally when the player is their real top bond", () => {
    const rel = new RelationshipModel(0.5);
    const self = npc(1);
    const others = [npc(2), npc(3)];
    rel.edge(self, npc(2)).threat = 0.9; // a peer is the threat (so target ≠ player)
    rel.edge(self, PLAYER).trust = 0.95;
    rel.edge(self, PLAYER).affinity = 0.9;
    const conf = confessionalFor(self, others, rel, { player: PLAYER });
    expect(conf.ally).toBe(PLAYER);
    expect(conf.target).not.toBe(PLAYER); // never named as both (issue #839 distinctness holds)
  });

  it("a player-subject confessional stays Vault-only: recorded witnessed by the NPC ALONE, never the player", () => {
    const rel = new RelationshipModel(0.5);
    const self = npc(1);
    rel.edge(self, PLAYER).threat = 0.95;
    const conf = confessionalFor(self, [npc(2), npc(3)], rel, { player: PLAYER });
    expect(conf.target).toBe(PLAYER);

    const events = new InMemoryEventStore();
    recordConfessional(events, conf, new SeededRandom(1), 0);
    const rec = events.queryAll().filter((e) => e.type === "confessional");
    expect(rec.length).toBe(1);
    // The player is NAMED (subject) but is NEVER a witness — the Vault Wall holds.
    expect(rec[0]!.content).toContain(PLAYER);
    expect(rec[0]!.witnessSet).toEqual([self]);
    expect(rec[0]!.witnessSet).not.toContain(PLAYER);
    expect(isVisibleTo(rec[0]!, PLAYER)).toBe(false);
  });

  it("involvedConfessionals: the player is never a CONFESSOR even when passed as a subject", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(npc(1), PLAYER).threat = 0.95;
    // The player is listed among the "involved" confessors — they must still be excluded as a confessor.
    const confs = involvedConfessionals([PLAYER, npc(1)], [npc(1), npc(2)], rel, () => ({ player: PLAYER }));
    expect(confs.every((c) => c.npc !== PLAYER)).toBe(true);
    expect(confs.some((c) => c.npc === npc(1))).toBe(true);
    // ...and the NPC confessor CAN now name the player as subject.
    expect(confs.find((c) => c.npc === npc(1))!.target).toBe(PLAYER);
  });
});
