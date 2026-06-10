import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { SoulStore } from "../../src/adapters/engine/SoulStore";
import {
  confessionalFor, involvedConfessionals, recordConfessionalToSoul,
} from "../../src/engine/confessionals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { PLAYER, npc } from "../../src/domain/ids";

const fake = new DeterministicEmbedding();
const embed = (t: string): number[] => fake.embed(t);
const newSoul = (): SoulStore => new SoulStore(embed);

// Roles only. Covers the LIVE ceremony wiring (0040 scenario 1) + the soul accumulation/recall
// capability (scenario 5). The Vault-only recording + engine-grounded read are in npcConfessionals.test.ts.

describe("0040 — confessionals at the live nomination ceremony", () => {
  function driveToNominations() {
    const s = new GameSessionAdapter();
    const recorded: Array<{ content: string; witnessSet: string[]; type?: string }> = [];
    s.setOnPlayerEvent((content, witnessSet, type) => {
      recorded.push({ content, witnessSet, type });
      return `evt:${recorded.length}`;
    });
    s.createCharacter({ playerName: "P", seed: 7 });
    // Advance until a nomination ceremony resolves (auto if an NPC is HOH; else submit the player's noms).
    for (let i = 0; i < 16; i++) {
      const v = s.advanceGame();
      const pending = v.pending;
      if (pending?.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" }); // B46
      else if (pending?.kind === "nominations") {
        const opts = pending.options.map((o) => o.id);
        s.submitDecision({ kind: "nominations", choice: [opts[0]!, opts[1]!] });
      }
      if (recorded.some((r) => r.type === "confessional")) break;
    }
    return recorded.filter((r) => r.type === "confessional");
  }

  it("the involved houseguests each record a private confessional at the ceremony", () => {
    const conf = driveToNominations();
    expect(conf.length).toBeGreaterThan(0);
  });

  it("every ceremony confessional is Vault-only — hidden, witnessed by the NPC alone, never the player", () => {
    for (const c of driveToNominations()) {
      expect(c.witnessSet).toHaveLength(1);
      expect(c.witnessSet).not.toContain(PLAYER);
    }
  });
});

describe("0040 — confessionals deepen the soul (accumulate + recall)", () => {
  const [A, B, C] = [npc(1), npc(2), npc(3)];

  it("excludes the player and dedupes the confessors", () => {
    const rel = new RelationshipModel(0.5);
    const confs = involvedConfessionals([PLAYER, A, A, B], [PLAYER, A, B, C], rel);
    expect(confs.map((c) => c.npc)).toEqual([A, B]); // no player, no duplicate A
  });

  it("a soul accumulates confessionals across beats without losing earlier ones", () => {
    const soul = newSoul();
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(1);
    // Beat 1: A reads B as the threat.
    for (let i = 0; i < 6; i++) rel.applyDirected(A, B, "betrayal", rng);
    recordConfessionalToSoul(soul, confessionalFor(A, [A, B, C], rel));
    const afterOne = soul.soulOf(A).memories.length;
    // Beat 2: A's read shifts toward C as the threat.
    for (let i = 0; i < 10; i++) rel.applyDirected(A, C, "betrayal", rng);
    recordConfessionalToSoul(soul, confessionalFor(A, [A, B, C], rel));
    const mems = soul.soulOf(A).memories;
    expect(mems.length).toBeGreaterThan(afterOne); // accumulates
    // The earlier confessional (naming B) is still there — never thinned (0007).
    expect(mems.some((m) => m.content.includes(B))).toBe(true);
  });

  it("a later recall can surface a specific past confessional", () => {
    const soul = newSoul();
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(2);
    for (let i = 0; i < 6; i++) rel.applyDirected(A, B, "betrayal", rng);
    recordConfessionalToSoul(soul, confessionalFor(A, [A, B, C], rel));
    const hits = soul.recall(A, `who is ${B}`, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((m) => m.content.includes(B))).toBe(true);
  });
});
