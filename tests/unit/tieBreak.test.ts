import { describe, it, expect } from "vitest";
import { newLiveSeason, advance, applyDecision, type SeasonCtx, type LiveSeasonState, type BeatEvent } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { cloneSession } from "../../src/engine/sessionSnapshot";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Drive a staged eviction (0047) from the "eviction" beat through its one-at-a-time vote reveal until
 * the result lands (the evictee is committed) OR it pauses for the player-HOH tie-break. Returns the
 * last beat (the "eviction" beat on a clean result; null when it pauses).
 */
function driveToEvictionResult(s: LiveSeasonState, ctx: SeasonCtx, rng: SeededRandom): BeatEvent | null {
  let last: BeatEvent | null = null;
  for (let g = 0; g < 50 && !s.pending && !s.eviction?.evictee && s.beat === "eviction"; g++) last = advance(s, ctx, rng);
  return last;
}

/**
 * Feature B44 / audit B2 — a player HOH breaks a tied eviction vote. The single most dramatic HOH
 * power must be the player's: the loop PAUSES on a `tie-break` decision instead of silently deciding
 * from the hidden player→NPC threat edges the player has never seen. HARD rule: roles only — no names.
 */
const ctxOf = (rel: RelationshipModel): SeasonCtx => ({ player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel });

/** A relationship layer where npc:3 reads npc:1 as the threat and npc:4 reads npc:2 — an even split. */
function tiedVoters(): RelationshipModel {
  const rel = new RelationshipModel(0.5);
  rel.edge(npc(3), npc(1)).threat = 0.9; rel.edge(npc(3), npc(2)).threat = 0.1; // npc:3 votes npc:1
  rel.edge(npc(4), npc(1)).threat = 0.1; rel.edge(npc(4), npc(2)).threat = 0.9; // npc:4 votes npc:2
  return rel;
}

/** A Final-5 eviction with the given HOH, the block set to [npc:1, npc:2], and a 1–1 voter split. */
function tiedEvictionState(hoh: typeof PLAYER): LiveSeasonState {
  const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4)]);
  s.beat = "eviction"; s.hoh = hoh; s.finalNominees = [npc(1), npc(2)];
  return s;
}

describe("B44 — a player HOH breaks a tied eviction vote", () => {
  it("on a tie with the player as HOH, the loop pauses for the player's deciding vote — after the reveal", () => {
    const ctx = ctxOf(tiedVoters());
    const s = tiedEvictionState(PLAYER);
    // The votes reveal one at a time (0047); the tie surfaces only once the last vote is read.
    driveToEvictionResult(s, ctx, new SeededRandom(1));
    expect(s.pending?.kind).toBe("tie-break"); // paused — not silently resolved
    expect((s.pending as { nominees: string[] }).nominees).toEqual([npc(1), npc(2)]);
  });

  it("refuses an illegal tie-break pick, then evicts the player's chosen nominee", () => {
    const ctx = ctxOf(tiedVoters());
    const s = tiedEvictionState(PLAYER);
    driveToEvictionResult(s, ctx, new SeededRandom(1));
    expect(() => applyDecision(s, { kind: "tie-break", evict: npc(3) }, ctx)).toThrow(); // not a nominee
    const ev = applyDecision(s, { kind: "tie-break", evict: npc(2) }, ctx);
    expect(ev.beat).toBe("eviction");
    expect(s.evictionOrder).toContain(npc(2));
    expect(s.active).not.toContain(npc(2));
    expect(s.pending).toBeUndefined();
  });

  it("an NPC HOH still auto-resolves a tie — no pause", () => {
    // hoh = npc:4 (an NPC); the player is a voter. Engineer a 1–1 tie; the NPC HOH breaks it silently.
    const rel = new RelationshipModel(0.5);
    rel.edge(npc(3), npc(1)).threat = 0.9; rel.edge(npc(3), npc(2)).threat = 0.1; // npc:3 votes npc:1
    rel.edge(npc(4), npc(1)).threat = 0.9; rel.edge(npc(4), npc(2)).threat = 0.1; // the HOH would break toward npc:1
    const ctx = ctxOf(rel);
    const s = tiedEvictionState(npc(4));

    const paused = advance(s, ctx, new SeededRandom(1));
    expect(paused).toBeNull(); // the PLAYER is a voter ⇒ pends an eviction-vote first
    expect(s.pending?.kind).toBe("eviction-vote");

    applyDecision(s, { kind: "eviction-vote", vote: npc(2) }, ctx); // player → npc:2, npc:3 → npc:1 ⇒ 1–1; opens the reveal
    expect(s.pending).toBeUndefined(); // NO tie-break pend — the NPC HOH auto-resolves at the reveal's end
    const ev = driveToEvictionResult(s, ctx, new SeededRandom(1));
    expect(ev!.beat).toBe("eviction");
    expect(s.evictionOrder).toContain(npc(1)); // the HOH broke toward npc:1
  });

  it("the tie-break decision survives an engine restart (resumes from the snapshot)", () => {
    const ctx = ctxOf(tiedVoters());
    const s = tiedEvictionState(PLAYER);
    driveToEvictionResult(s, ctx, new SeededRandom(1));
    expect(s.pending?.kind).toBe("tie-break");

    const restored = cloneSession<LiveSeasonState>(s); // a durable round-trip (0030), mid-reveal + owed the tie-break
    expect(restored.pending?.kind).toBe("tie-break");
    expect(restored.eviction?.stage).toBe("votes"); // the staged eviction round-trips too
    const ev = applyDecision(restored, { kind: "tie-break", evict: npc(1) }, ctx);
    expect(ev.beat).toBe("eviction");
    expect(restored.evictionOrder).toContain(npc(1));
  });
});
