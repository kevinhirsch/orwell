import { describe, it, expect } from "vitest";
import { tallyJury, chooseNominations } from "../../src/engine/season";
import { playSeason } from "../../src/engine/calibration";
import { newLiveSeason, advance, applyDecision } from "../../src/engine/liveSeason";
import type { SeasonCtx } from "../../src/engine/liveSeason";
import type { SeasonHouseguest } from "../../src/engine/season";
import { RelationshipModel } from "../../src/engine/relationships";
import { generateHouse } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

function build16(seed: number): SeasonHouseguest[] {
  const { npcs } = generateHouse(new SeededRandom(seed));
  return [{ id: PLAYER, stats: { physical: 0.5, mental: 0.5, social: 0.5 } }, ...npcs.map((n) => ({ id: n.id, stats: n.character.stats }))];
}

describe("weekly loop orchestration", () => {
  it("plays a deterministic season to a single winner", () => {
    const roster = build16(1);
    const a = playSeason({ seed: 1, houseguests: roster });
    const b = playSeason({ seed: 1, houseguests: roster });
    expect(a).toEqual(b);
    expect(a.finalTwo).toContain(a.winner);
    expect(a.evictionOrder).toHaveLength(14);
    expect(a.jury).toHaveLength(9);
    expect(a.jury).toEqual(a.evictionOrder.slice(-9));
    expect(a.preJury).toHaveLength(5);
    expect(a.weeks).toHaveLength(14);
  });

  it("every week is legal: HOH not nominated, replacement isn't the veto winner, evictee is a final nominee", () => {
    const { weeks } = playSeason({ seed: 5, houseguests: build16(5) });
    for (const w of weeks) {
      expect(w.finalNominees).not.toContain(w.hoh);
      expect(w.finalNominees).toContain(w.evictee);
      if (w.vetoUsed) expect(w.replacement).not.toBe(w.vetoHolder);
    }
  });

  it("tallyJury: most votes wins; a tie is broken by the last-evicted juror", () => {
    const a = npc(10);
    const b = npc(11);
    expect(tallyJury([npc(1), npc(2), npc(3)], [a, b], (j) => (j === npc(3) ? b : a), [npc(1), npc(2), npc(3)])).toBe(a);
    // 1–1 tie; last juror (npc(2)) voted b → b wins.
    expect(tallyJury([npc(1), npc(2)], [a, b], (j) => (j === npc(1) ? a : b), [npc(1), npc(2)])).toBe(b);
  });

  it("nominations are the top-2 threats, not chance", () => {
    const rel = new RelationshipModel(0.5);
    const active = [PLAYER, npc(1), npc(2), npc(3), npc(4)];
    rel.edge(PLAYER, npc(2)).threat = 0.9;
    rel.edge(PLAYER, npc(4)).threat = 0.8;
    rel.edge(PLAYER, npc(1)).threat = 0.2;
    rel.edge(PLAYER, npc(3)).threat = 0.1;
    expect(chooseNominations(PLAYER, active, rel).sort()).toEqual([npc(2), npc(4)].sort());
  });

  it("the live loop rejects illegal player nomination choices (one rulebook, B55)", () => {
    const rng = new SeededRandom(1);
    const ctx: SeasonCtx = {
      player: PLAYER,
      statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }),
      rel: new RelationshipModel(0.5),
    };
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3)]);
    s.beat = "nominations";
    s.hoh = PLAYER;
    expect(advance(s, ctx, rng)).toBeNull(); // pauses on the player's decision
    expect(() => applyDecision(s, { kind: "nominations", choice: [PLAYER, npc(1)] }, ctx, rng)).toThrow();
    expect(() => applyDecision(s, { kind: "nominations", choice: [npc(1), npc(1)] }, ctx, rng)).toThrow();
    expect(s.pending).toBeTruthy(); // the pending decision survives illegal attempts
    expect(() => applyDecision(s, { kind: "nominations", choice: [npc(1), npc(2)] }, ctx, rng)).not.toThrow();
  });
});
