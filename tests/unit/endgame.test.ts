import { describe, it, expect } from "vitest";
import { vetoParticipants, vetoFieldSize, evictionVoters, type WeekState } from "../../src/domain/eligibility";
import { newLiveSeason, advance, applyDecision, type SeasonCtx } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView } from "../../src/ports/GameSession";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature 0045 / audit B1 — the endgame is legal and modeled. The veto field degrades to the
 * remaining house, Final 4 resolves on the sole vote, and Final 3 is a final-HOH personal eviction
 * through the 0034 seam. HARD rule: roles only — no names.
 */
const ctxOf = (rel: RelationshipModel): SeasonCtx => ({
  player: PLAYER,
  statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }),
  rel,
});

describe("0045 — the veto field degrades to the remaining house", () => {
  it("vetoFieldSize is min(6, remaining)", () => {
    expect(vetoFieldSize(16)).toBe(6);
    expect(vetoFieldSize(6)).toBe(6);
    expect(vetoFieldSize(5)).toBe(5);
    expect(vetoFieldSize(4)).toBe(4);
  });

  it("the drawn veto field is legal at Final 5 (5) and Final 4 (4) — distinct, no evicted", () => {
    const rng = new SeededRandom(3);
    const week5: WeekState = { houseguests: [npc(1), npc(2), npc(3), npc(4), npc(5)], player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)] };
    const f5 = vetoParticipants(week5, rng).participants;
    expect(f5).toHaveLength(5);
    expect(new Set(f5).size).toBe(5);
    expect(f5.every((id) => week5.houseguests.includes(id))).toBe(true);

    const week4: WeekState = { houseguests: [npc(1), npc(2), npc(3), npc(4)], player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)] };
    const f4 = vetoParticipants(week4, rng).participants;
    expect(f4).toHaveLength(4);
    expect(new Set(f4).size).toBe(4);
  });

  it("at Final 4 exactly one houseguest casts the eviction vote (no tie possible)", () => {
    const week4: WeekState = { houseguests: [npc(1), npc(2), npc(3), npc(4)], player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)] };
    expect(evictionVoters(week4)).toEqual([npc(4)]); // the sole non-HOH, non-nominee
  });
});

describe("0045 — Final 3 is a final-HOH personal eviction", () => {
  it("skips nominations and the veto after the final-HOH competition", () => {
    const s = newLiveSeason([PLAYER, npc(1), npc(2)]); // three active ⇒ opens on the final HOH comp
    const ctx = ctxOf(new RelationshipModel(0.5));
    const rng = new SeededRandom(1);
    advance(s, ctx, rng); // B46: the player plays the final HOH comp ⇒ declares intent first
    const ev = applyDecision(s, { kind: "comp-intent", intent: "compete" }, ctx, rng);
    expect(ev.beat).toBe("hoh-competition");
    expect(s.beat).toBe("final-eviction"); // straight to the eviction — no nominations/veto
  });

  it("the player as final HOH gets the binding choice; an illegal pick is refused", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    const s = newLiveSeason([PLAYER, npc(1), npc(2)]);
    s.hoh = PLAYER; s.beat = "final-eviction";

    expect(advance(s, ctx, new SeededRandom(1))).toBeNull(); // pauses for the player
    expect(s.pending?.kind).toBe("final-eviction");
    expect((s.pending as { options: string[] }).options).toEqual([npc(1), npc(2)]);
    expect(() => applyDecision(s, { kind: "final-eviction", evict: PLAYER }, ctx)).toThrow(); // can't evict self

    const ev = applyDecision(s, { kind: "final-eviction", evict: npc(1) }, ctx);
    expect(ev.beat).toBe("final-eviction");
    expect(s.evictionOrder).toContain(npc(1));
    expect(s.active).toEqual([PLAYER, npc(2)]); // the Final 2
    expect(s.beat).toBe("finale");
  });

  it("an NPC final HOH evicts the higher-threat rival (relationship-driven), recording the manner", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(npc(1), npc(2)).threat = 0.9; // npc:1 (HOH) reads npc:2 as the bigger threat
    rel.edge(npc(1), PLAYER).threat = 0.1;
    const s = newLiveSeason([PLAYER, npc(1), npc(2)]);
    s.hoh = npc(1); s.beat = "final-eviction";

    const ev = advance(s, ctxOf(rel), new SeededRandom(1));
    expect(ev!.beat).toBe("final-eviction");
    expect(s.evictionOrder).toContain(npc(2)); // the higher threat goes
    expect(s.active).toEqual([PLAYER, npc(1)]);
    expect(s.mannerByEvictee?.[npc(2)]).toBeDefined(); // manner recorded for the jury
    expect(s.beat).toBe("finale");
  });
});

describe("0045 — a seeded season reaches Final 2 with every late ceremony legal", () => {
  it("plays a full game; each veto field is min(6, remaining) and no eviction has an empty electorate", () => {
    const session = new GameSessionAdapter();
    session.createCharacter({ playerName: "P", seed: 2 });
    const resolve = (p: NonNullable<AdvanceView["pending"]>): void => {
      if (p.kind === "nominations") session.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
      else if (p.kind === "veto-decision") session.submitDecision({ kind: "veto-decision", use: false });
      else if (p.kind === "replacement") session.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
      else if (p.kind === "final-eviction") session.submitDecision({ kind: "final-eviction", vote: p.options[0]!.id });
      else if (p.kind === "finale-statement") session.submitDecision({ kind: "finale-statement", statement: "x" });
      else if (p.kind === "finale-answer") session.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
      else if (p.kind === "juror-vote") session.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
      else session.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
    };

    let finished = false;
    let sawFinalEviction = false;
    for (let i = 0; i < 6000 && !finished; i++) {
      const adv = session.advanceGame();
      if (adv.event?.beat === "veto-competition") {
        const live = session.snapshot().live!;
        expect(live.vetoField!.length).toBe(vetoFieldSize(live.active.length)); // degrades correctly
      }
      if (adv.event?.beat === "final-eviction") sawFinalEviction = true;
      if (adv.pending) resolve(adv.pending);
      finished = adv.finished;
    }
    expect(finished).toBe(true);
    expect(sawFinalEviction).toBe(true); // the F3 branch actually ran (no silent 0–0 tie)
  });
});
