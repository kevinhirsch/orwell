import { describe, it, expect } from "vitest";
import { loadReserveTwists, maybeFireTwist, firedTwists, isDramaticBeat, RESERVE_POOL } from "../../src/engine/reserveTwists";
import { selectableReplacements, evictionVoters } from "../../src/domain/eligibility";
import type { WeekState } from "../../src/domain/eligibility";
import { playSeason } from "../../src/engine/calibration";
import { generateHouse } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

describe("0025 — reserve twists (Vault-sealed, engine-timed)", () => {
  it("fires rarely and deterministically (same seed → same twists + timing)", () => {
    let everEmpty = false, everFired = false;
    for (let seed = 1; seed <= 40; seed++) {
      const r1 = loadReserveTwists(1, new SeededRandom(seed));
      const r2 = loadReserveTwists(1, new SeededRandom(seed));
      expect(r1).toEqual(r2); // deterministic by seed
      const fires = firedTwists(r1);
      expect(fires.length).toBeLessThanOrEqual(1); // ≤ enabled count
      for (const f of fires) expect(isDramaticBeat(f.beat)).toBe(true);
      everEmpty ||= fires.length === 0;
      everFired ||= fires.length === 1;
    }
    expect(everEmpty).toBe(true); // often none
    expect(everFired).toBe(true); // but it does happen
  });

  it("never loads more than the admin-enabled count, only from the curated pool", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = loadReserveTwists(2, new SeededRandom(seed));
      expect(r.length).toBeLessThanOrEqual(2);
      for (const t of r) expect(RESERVE_POOL).toContain(t.kind);
    }
  });

  it("a fired twist is identifiable at exactly its sealed beat", () => {
    const reserve = [{ kind: "secret-veto" as const, fireAtBeat: 5 }];
    expect(maybeFireTwist(4, reserve)).toBeNull();
    expect(maybeFireTwist(5, reserve)).toEqual({ kind: "secret-veto", beat: 5 });
  });

  it("format-preserving: 0005 invariants hold and the season still reaches jury-9 → final-2", () => {
    // Eligibility invariants are unchanged by a twist (the rules are computed in the domain core).
    const week: WeekState = {
      houseguests: [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)],
      player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)], vetoWinner: npc(4),
    };
    expect(selectableReplacements(week)).not.toContain(npc(4)); // veto winner still excluded
    expect(evictionVoters(week)).not.toContain(npc(1));         // HOH still doesn't vote

    const roster = [{ id: PLAYER, stats: { physical: 0.5, mental: 0.5, social: 0.5 } },
      ...generateHouse(new SeededRandom(5)).npcs.map((n) => ({ id: n.id, stats: n.character.stats }))];
    const outcome = playSeason({ seed: 5, houseguests: roster });
    expect(outcome.jury).toHaveLength(9);
    expect(outcome.finalTwo).toHaveLength(2);
  });
});
