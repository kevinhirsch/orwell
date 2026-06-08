import { describe, it, expect } from "vitest";
import {
  eligibleForHOH, vetoParticipants, selectableReplacements, evictionVoters, breaksTie,
} from "../../src/domain/eligibility";
import type { WeekState } from "../../src/domain/eligibility";
import { PLAYER, npc } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

const PULLERS = [npc(1), npc(2), npc(3)];
const week = (over: Partial<WeekState> = {}): WeekState => ({
  houseguests: [PLAYER, ...Array.from({ length: 15 }, (_, i) => npc(i + 1))],
  player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)], ...over,
});

describe("competition eligibility & legality", () => {
  it("excludes the outgoing HOH unless a special comp permits", () => {
    const w = week({ outgoingHoh: npc(4) });
    expect(eligibleForHOH(w)).not.toContain(npc(4));
    expect(eligibleForHOH(w, { specialAllowsOutgoingHoh: true })).toContain(npc(4));
  });

  it("excludes the veto winner from replacements", () => {
    expect(selectableReplacements(week({ vetoWinner: npc(5) }))).not.toContain(npc(5));
  });

  it("eviction voters exclude HOH+nominees; HOH breaks ties", () => {
    const w = week();
    const v = evictionVoters(w);
    for (const p of PULLERS) expect(v).not.toContain(p);
    expect(v).toContain(PLAYER);
    expect(breaksTie(w)).toBe(npc(1));
  });

  it("veto field is always six, includes pullers, and is reproducible by seed", () => {
    const w = week();
    for (let s = 1; s <= 50; s++) {
      const a = vetoParticipants(w, new SeededRandom(s), { houseguestsChoiceChip: true });
      const b = vetoParticipants(w, new SeededRandom(s), { houseguestsChoiceChip: true });
      expect(a.participants).toHaveLength(6);
      expect(new Set(a.participants).size).toBe(6);
      for (const p of PULLERS) expect(a.participants).toContain(p);
      expect(a.participants).toEqual(b.participants);
    }
  });
});
