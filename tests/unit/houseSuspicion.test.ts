import { describe, it, expect } from "vitest";
import { whisperConspicuousPairings } from "../../src/engine/houseSuspicion";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { RelationshipModel } from "../../src/engine/relationships";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { Room, Occupancy } from "../../src/domain/house";
import { adrFixture } from "../support/adr0003";

/**
 * Feature 0077 NPC-side increment — the house WHISPERS about closed-door pairings. When two NPCs are
 * conspicuously holed up in a private room, an onlooker notices and a Vault-free POSITION suspicion
 * diffuses NPC-to-NPC and can reach the player. The load-bearing guarantee: TEXTURE only — a dedicated
 * rng + NO relationship fold, so the seeded society/vote spine is byte-identical (the heavy juryReach +
 * gradient sims are the end-to-end proof; this file proves the local properties). Roles only.
 */

const SEALED = "SEALED-0077-what-the-pair-actually-schemed";

// npc(1) + npc(2) holed up in the lounge (a PRIVATE room), both lingering; npc(3) is out in the kitchen
// (the public core) to plausibly notice; the player is in the living room.
function pairingOccupancy(): Occupancy {
  return new Map<EntityId, Room>([
    [PLAYER, "living-room"], [npc(1), "lounge"], [npc(2), "lounge"], [npc(3), "kitchen"], [npc(4), "kitchen"],
  ]);
}
const NPCS = [npc(1), npc(2), npc(3), npc(4)];
const lingering = (id: EntityId) => 3; // everyone has lingered (≥ conspicuousMinTenureTicks)
const warmAffinity = (a: EntityId, b: EntityId) => (a === b ? 0 : 0.5); // a connected affinity graph

function freshKnowledge(): InMemoryKnowledgeService {
  return new InMemoryKnowledgeService(new InMemoryEventStore());
}

describe("0077 house whisper — a conspicuous NPC pairing diffuses a Vault-free suspicion", () => {
  it("origin holds it, it can reach the player, and it NEVER carries the sealed scene content", () => {
    let fires = 0;
    let reachedPlayer = 0;
    for (let seed = 0; seed < 200; seed++) {
      const knowledge = freshKnowledge();
      const out = whisperConspicuousPairings({
        occupancy: pairingOccupancy(), tenureOf: lingering, npcs: NPCS, player: PLAYER,
        affinity: warmAffinity, nameOf: (id) => `HG-${id}`, knowledge, rng: new SeededRandom(seed),
      });
      if (out.length === 0) continue; // the gate stayed shut this seed
      fires++;
      const origin = out[0]!.origin;
      // The pair are the two NPCs in the lounge; the origin is a third NPC out in the open.
      expect(out[0]!.room).toBe("lounge");
      expect([npc(1), npc(2)]).toContain(out[0]!.pair[0]);
      expect([npc(3), npc(4)]).toContain(origin);
      // The origin holds the suspicion, naming who + where — never the sealed content.
      const held = knowledge.knownTo(origin).find((f) => f.content.includes("lounge"));
      expect(held, "the onlooker holds the suspicion").toBeTruthy();
      expect(held!.content).not.toContain(SEALED);
      // Anyone the rumor reached holds only the position fact — never the scene.
      for (const id of [PLAYER, ...NPCS]) {
        for (const f of knowledge.knownTo(id)) expect(f.content).not.toContain(SEALED);
      }
      if (knowledge.knownTo(PLAYER).some((f) => /HG-|lounge/.test(f.content))) reachedPlayer++;
    }
    expect(fires, "the gate opens a real fraction of the time").toBeGreaterThan(0);
    expect(reachedPlayer, "a chain reaches the player sometimes (the house tells them)").toBeGreaterThan(0);
  });

  it("no conspicuous pairing ⇒ nothing whispered (a public-core pair, or one that hasn't lingered)", () => {
    // Same two NPCs, but in the OPEN kitchen (public core) — never private, never a tell.
    const publicPair = new Map<EntityId, Room>([
      [PLAYER, "living-room"], [npc(1), "kitchen"], [npc(2), "kitchen"], [npc(3), "backyard"],
    ]);
    for (let seed = 0; seed < 50; seed++) {
      expect(whisperConspicuousPairings({
        occupancy: publicPair, tenureOf: lingering, npcs: NPCS, player: PLAYER,
        affinity: warmAffinity, nameOf: (id) => `HG-${id}`, knowledge: freshKnowledge(), rng: new SeededRandom(seed),
      })).toEqual([]);
    }
    // A private pair that just arrived (tenure 0) is not yet conspicuous.
    for (let seed = 0; seed < 50; seed++) {
      expect(whisperConspicuousPairings({
        occupancy: pairingOccupancy(), tenureOf: () => 0, npcs: NPCS, player: PLAYER,
        affinity: warmAffinity, nameOf: (id) => `HG-${id}`, knowledge: freshKnowledge(), rng: new SeededRandom(seed),
      })).toEqual([]);
    }
  });

  it("no onlooker in the observable house ⇒ no metaphysical read (nothing rises)", () => {
    // Everyone except the pair is ALSO behind closed doors — no one is positioned to notice.
    const noWitness = new Map<EntityId, Room>([
      [PLAYER, "living-room"], [npc(1), "lounge"], [npc(2), "lounge"], [npc(3), "bedroom-a"], [npc(4), "bedroom-b"],
    ]);
    for (let seed = 0; seed < 50; seed++) {
      expect(whisperConspicuousPairings({
        occupancy: noWitness, tenureOf: lingering, npcs: NPCS, player: PLAYER,
        affinity: warmAffinity, nameOf: (id) => `HG-${id}`, knowledge: freshKnowledge(), rng: new SeededRandom(seed),
      })).toEqual([]);
    }
  });
});

describe("0077 house whisper — calibration-neutral (texture only, no relationship fold)", () => {
  it("a fired whisper moves NO relationship edge (the spine stays byte-identical)", () => {
    // A REAL relationship model backs the affinity read; the whisper must not fold a single edge.
    const rel = new RelationshipModel(0.5);
    const ids = [PLAYER, ...NPCS];
    // Seed some asymmetric edges so a fold would be detectable.
    for (const a of ids) for (const b of ids) if (a !== b) { rel.edge(a, b).affinity = 0.5; rel.edge(a, b).trust = 0.4; rel.edge(a, b).threat = 0.3; }
    const snapshot = () => ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => {
      const e = rel.edge(a, b); return `${a}>${b}:${e.affinity},${e.trust},${e.threat}`;
    })).join("|");
    const before = snapshot();
    // Drive enough seeds to fire several whispers.
    for (let seed = 0; seed < 200; seed++) {
      whisperConspicuousPairings({
        occupancy: pairingOccupancy(), tenureOf: lingering, npcs: NPCS, player: PLAYER,
        affinity: (a, b) => rel.edge(a, b).affinity, nameOf: (id) => `HG-${id}`,
        knowledge: freshKnowledge(), rng: new SeededRandom(seed),
      });
    }
    expect(snapshot(), "no relationship edge moved — the whisper is pure texture").toBe(before);
  });
});

describe("0077 house whisper — the session wiring (whisperPairings)", () => {
  it("reads the live weighted occupancy + tenure and lands a Vault-free suspicion via the engine path", () => {
    const fx = adrFixture("u-whisper", 7);
    const s = fx.sb.session;
    const k = fx.sb.engine.knowledge;
    // Seed a connected affinity graph (the session reads the SAME relationship model) so diffusion can run.
    const ids = [PLAYER, npc(1), npc(2), npc(3)];
    for (const a of ids) for (const b of ids) if (a !== b) fx.sb.engine.relationships.edge(a, b).affinity = 0.5;
    // Plant a conspicuous pairing: npc1+npc2 lingering in the lounge (private), an onlooker in the kitchen.
    const planted = { [PLAYER]: "living-room", [npc(1)]: "lounge", [npc(2)]: "lounge", [npc(3)]: "kitchen" } as Record<EntityId, Room>;
    const tenure = { [npc(1)]: 4, [npc(2)]: 4, [npc(3)]: 2 } as Record<EntityId, number>;
    let landed = false;
    for (let tick = 1; tick <= 80 && !landed; tick++) {
      const core = s.snapshot();
      core.presence = planted;
      core.presenceTenure = tenure;
      core.presenceTickCount = tick; // varies the DEDICATED rng seed, so the gate eventually opens
      s.restore(core);
      s.whisperPairings(k);
      landed = ids.some((id) => k.knownTo(id).some((f) => /lounge/.test(f.content)));
    }
    expect(landed, "the engine path landed a Vault-free pairing suspicion within the bound").toBe(true);
    // And no sealed scene content ever rode along (Vault-free by construction).
    for (const id of ids) for (const f of k.knownTo(id)) expect(f.content).not.toContain(SEALED);
  });
});
