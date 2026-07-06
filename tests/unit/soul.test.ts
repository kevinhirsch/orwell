import { describe, it, expect } from "vitest";
import {
  SoulStore,
  classifySoulSection,
  composeSectionedNarrative,
} from "../../src/adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { generateHouse } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";
import type { Memory } from "../../src/ports/SoulProvider";

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

  // ── Option B: the lightly-sectioned inner diary (PO ruling 2026-07-06) ─────────────
  describe("Option B — the inner diary is organised into sections", () => {
    it("classifies a memory by content: happenings vs leanings vs feelings", () => {
      expect(classifySoulSection("won the veto competition in the backyard")).toBe("memory");
      expect(classifySoulSection("I'm leaning toward taking them to the final two")).toBe("leaning");
      expect(classifySoulSection("blindsided by an eviction — rattled, guarded now")).toBe("feeling");
    });

    it("an emotion reading wins over a strategic one (feeling before leaning)", () => {
      // "betrayed" is felt; the strategic verb "betray" must not steal it into a leaning.
      expect(classifySoulSection("betrayed by someone they trusted — wary")).toBe("feeling");
    });

    it("an explicit section overrides the content classifier", () => {
      const s = store();
      const m = s.recordToSoul(HG, "a plain kitchen chat", "leaning");
      expect(m.section).toBe("leaning");
    });

    it("renders the diary under Memories / Leanings / Feelings headings, in order", () => {
      const s = store();
      s.recordToSoul(HG, "won the HOH competition");                       // memory
      s.recordToSoul(HG, "leaning toward an alliance with the cook");      // leaning
      s.recordToSoul(HG, "felt crushed after the blindside");              // feeling
      const nar = s.soulOf(HG).narrative;
      expect(nar).toContain("## Memories");
      expect(nar).toContain("## Leanings");
      expect(nar).toContain("## Feelings");
      // fixed section order regardless of insertion order
      expect(nar.indexOf("## Memories")).toBeLessThan(nar.indexOf("## Leanings"));
      expect(nar.indexOf("## Leanings")).toBeLessThan(nar.indexOf("## Feelings"));
    });

    it("only renders a heading for a section that has content", () => {
      const s = store();
      s.recordToSoul(HG, "won the HOH competition"); // a plain happening only
      const nar = s.soulOf(HG).narrative;
      expect(nar).toContain("## Memories");
      expect(nar).not.toContain("## Leanings");
      expect(nar).not.toContain("## Feelings");
    });

    it("the composer keeps append order within a section and never thins the record", () => {
      const mems: Memory[] = [
        { id: "a", content: "won the HOH", ts: 1, section: "memory" },
        { id: "b", content: "then won the veto", ts: 2, section: "memory" },
      ];
      const nar = composeSectionedNarrative(mems);
      expect(nar.indexOf("won the HOH")).toBeLessThan(nar.indexOf("then won the veto"));
    });

    it("sections re-derive identically from the same content (restore-stable)", () => {
      const lines = ["won the veto", "leaning toward the cook", "felt rattled after the vote"];
      const a = store(); const b = store();
      lines.forEach((l) => a.recordToSoul(HG, l));
      lines.forEach((l) => b.recordToSoul(HG, l));
      expect(a.soulOf(HG).narrative).toBe(b.soulOf(HG).narrative);
      expect(a.soulOf(HG).memories.map((m) => m.section))
        .toEqual(b.soulOf(HG).memories.map((m) => m.section));
    });
  });
});
