import { describe, it, expect } from "vitest";
import { SoulStore } from "../../src/adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { generateHouse } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

const fake = new DeterministicEmbedding();
const embed = (t: string): number[] => fake.embed(t);
const store = (): SoulStore => new SoulStore(embed);
const HG = npc(1);

describe("0024 — soul storage & semantic recall", () => {
  it("recalls the relevant memory, not crowded out by recent trivial ones", () => {
    const s = store();
    s.recordToSoul(HG, "a brutal veto betrayal that cut deep");
    for (let i = 0; i < 8; i++) s.recordToSoul(HG, `trivial chat about breakfast cereal ${i}`);
    const r = s.recall(HG, "the veto betrayal", 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toContain("veto betrayal");
  });

  it("is deterministic under the fake embedding + content", () => {
    const build = (): string[] => {
      const s = store();
      s.recordToSoul(HG, "the veto betrayal");
      s.recordToSoul(HG, "a quiet kitchen chat");
      return s.recall(HG, "betrayal", 2).map((m) => m.content);
    };
    expect(build()).toEqual(build());
  });

  it("recall sharpens the read: a salient old adverse memory is retrieved after a quiet stretch", () => {
    const s = store();
    s.recordToSoul(HG, "they blindsided me with a cruel veto betrayal");
    for (let i = 0; i < 6; i++) s.recordToSoul(HG, `pleasant small talk ${i}`);
    const adverse = s.recall(HG, "veto betrayal", 1)[0]!;
    expect(adverse.content).toMatch(/betrayal/);
  });

  it("deepens monotonically; the record never thins", () => {
    const s = store();
    let prevCount = 0, prevLen = 0;
    for (let i = 0; i < 10; i++) {
      s.recordToSoul(HG, `memory ${i} about the season`);
      const soul = s.soulOf(HG);
      expect(soul.memories.length).toBeGreaterThan(prevCount);
      expect(soul.narrative.length).toBeGreaterThan(prevLen);
      prevCount = soul.memories.length;
      prevLen = soul.narrative.length;
    }
  });

  it("the static Character stays byte-stable while the soul deepens", () => {
    const hg = generateHouse(new SeededRandom(3)).npcs[0]!;
    const characterBefore = JSON.stringify(hg.character);
    const s = store();
    for (let i = 0; i < 5; i++) s.recordToSoul(hg.id, `event ${i}`);
    expect(JSON.stringify(hg.character)).toBe(characterBefore); // recording to the soul never touches Character
    expect(s.soulOf(hg.id).memories.length).toBe(5);
  });

  it("recall is safe (empty) for a houseguest with no soul yet", () => {
    expect(store().recall(npc(9), "anything", 3)).toEqual([]);
  });
});
