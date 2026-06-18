import { describe, it, expect } from "vitest";
import { newLiveSeason, applyDecision, type SeasonCtx, type LiveSeasonState } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Round-2 playtest finding (MED): a nominee who wins the veto and saves THEMSELF rendered as
 * "X uses the veto on X" in the player-facing recap/beat prose ("Kaitlyn uses the veto on Kaitlyn").
 * A self-save must read "uses the veto on themselves". HARD rule: roles only — no names.
 */
const ctxOf = (rel: RelationshipModel): SeasonCtx => ({
  player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel,
});

/** Stage a veto-ceremony with the given nominees/holder and a live veto-decision pending. */
function staged(nominees: [string, string], holder: string): { s: LiveSeasonState; ctx: SeasonCtx } {
  const ctx = ctxOf(new RelationshipModel(0.5));
  const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)]);
  s.beat = "veto-ceremony"; s.hoh = npc(1); s.nominees = nominees; s.vetoHolder = holder;
  s.pending = { kind: "veto-decision", by: holder, nominees, saveable: [...nominees] };
  return { s, ctx };
}

describe("veto-ceremony prose — a self-save never says 'uses the veto on <self> <self>'", () => {
  it("a nominee saving THEMSELF reads 'uses the veto on themselves'", () => {
    const { s, ctx } = staged([PLAYER, npc(2)], PLAYER); // the player is a nominee AND holds the veto
    const ev = applyDecision(s, { kind: "veto-decision", use: true, save: PLAYER }, ctx, new SeededRandom(1));
    expect(ev.content).toContain("uses the veto on themselves");
    expect(ev.content).not.toMatch(/player[^;]*uses the veto on[^;]*player/); // never the doubled id
  });

  it("saving SOMEONE ELSE still names them (no regression)", () => {
    const { s, ctx } = staged([npc(2), npc(3)], PLAYER); // the player holds the veto, saves another
    const ev = applyDecision(s, { kind: "veto-decision", use: true, save: npc(2) }, ctx, new SeededRandom(1));
    expect(ev.content).toContain(`uses the veto on ${npc(2)}`);
    expect(ev.content).not.toContain("themselves");
  });
});
