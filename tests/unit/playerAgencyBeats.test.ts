import { describe, it, expect } from "vitest";
import {
  newLiveSeason, advance, applyDecision,
  type SeasonCtx, type LiveSeasonState, type BeatEvent,
} from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * E34 — the player's goodbye message is THEIR decision (the engine never speaks for the player)
 * and E37 — the player-juror's question beat at the finale (scoreless). Roles only — no names.
 */
const ctxOf = (rel: RelationshipModel): SeasonCtx => ({
  player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel,
});

/** A staged eviction with the PLAYER as HOH (surviving): nominees [npc1, npc2], npc2 voted out 3–1. */
function stagedEviction(): { s: LiveSeasonState; ctx: SeasonCtx; evictee: EntityId } {
  const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6)]);
  s.beat = "eviction"; s.hoh = PLAYER; s.finalNominees = [npc(1), npc(2)];
  const rel = new RelationshipModel(0.5);
  for (const v of [npc(3), npc(4), npc(5)]) { rel.edge(v, npc(2)).threat = 0.9; rel.edge(v, npc(1)).threat = 0.1; }
  rel.edge(npc(6), npc(1)).threat = 0.9; rel.edge(npc(6), npc(2)).threat = 0.1;
  return { s, ctx: ctxOf(rel), evictee: npc(2) };
}

/** Advance until the player's goodbye pending fires (collecting beats), bounded. */
function driveToPlayerGoodbye(s: LiveSeasonState, ctx: SeasonCtx, rng: SeededRandom): BeatEvent[] {
  const beats: BeatEvent[] = [];
  for (let g = 0; g < 100 && !s.pending; g++) {
    const ev = advance(s, ctx, rng);
    if (ev) beats.push(ev);
  }
  return beats;
}

describe("E34 — the engine never authors the player's goodbye message", () => {
  it("pauses for the player's own goodbye; NO player goodbye beat exists before the decision resolves", () => {
    const { s, ctx, evictee } = stagedEviction();
    const beats = driveToPlayerGoodbye(s, ctx, new SeededRandom(7));
    // The loop paused on the player's goodbye decision — never an engine-authored player beat.
    expect(s.pending).toMatchObject({ kind: "goodbye-message", by: PLAYER, evictee });
    for (const b of beats.filter((b) => b.beat === "eviction-goodbye")) {
      expect(b.participants[0]).not.toBe(PLAYER);
      expect(b.content.startsWith(PLAYER)).toBe(false);
    }
    // Resolving the decision produces the player's goodbye beat — only then.
    const ev = applyDecision(s, { kind: "goodbye-message", tone: "respectful" }, ctx);
    expect(ev.beat).toBe("eviction-goodbye");
    expect(ev.participants[0]).toBe(PLAYER);
  });

  it("the tone is the PLAYER's choice — never computed from their hidden edge", () => {
    const { s, ctx, evictee } = stagedEviction();
    // The player ADORES the evictee on the hidden edge — the old engine would assert "warm".
    ctx.rel.edge(PLAYER, evictee).affinity = 0.95;
    driveToPlayerGoodbye(s, ctx, new SeededRandom(7));
    expect(s.pending?.kind).toBe("goodbye-message");
    // The player chooses COLD anyway: the fold honors the choice, not the edge (agency, E34).
    applyDecision(s, { kind: "goodbye-message", tone: "cold" }, ctx);
    expect(s.mannerByEvictee![evictee]![PLAYER]!.disrespected).toBe(true);
  });

  it("folds via goodbyeMannerFor exactly as NPC tones: warm/respectful ⇒ respected; cold ⇒ disrespected", () => {
    for (const [tone, key] of [["warm", "respected"], ["respectful", "respected"], ["cold", "disrespected"]] as const) {
      const { s, ctx, evictee } = stagedEviction();
      driveToPlayerGoodbye(s, ctx, new SeededRandom(7));
      applyDecision(s, { kind: "goodbye-message", tone }, ctx);
      expect(s.mannerByEvictee![evictee]![PLAYER]![key]).toBe(true);
    }
  });

  it("refuses an illegal tone with the decision standing", () => {
    const { s, ctx } = stagedEviction();
    driveToPlayerGoodbye(s, ctx, new SeededRandom(7));
    expect(() => applyDecision(s, { kind: "goodbye-message", tone: "snarky" as never }, ctx)).toThrow(/tone/);
    expect(s.pending?.kind).toBe("goodbye-message");
  });

  it("an EVICTED player records no goodbye to themselves; the house still sends theirs (0046 intact)", () => {
    const s = newLiveSeason([PLAYER, npc(1), npc(3), npc(4), npc(5), npc(6)]);
    s.beat = "eviction"; s.hoh = npc(1); s.finalNominees = [PLAYER, npc(3)];
    const rel = new RelationshipModel(0.5);
    for (const v of [npc(4), npc(5), npc(6)]) { rel.edge(v, PLAYER).threat = 0.9; rel.edge(v, npc(3)).threat = 0.1; }
    const ctx = ctxOf(rel);
    const rng = new SeededRandom(3);
    const beats: BeatEvent[] = [];
    for (let g = 0; g < 100 && s.beat === "eviction"; g++) {
      expect(s.pending).toBeUndefined(); // the evicted player has no goodbye decision
      const ev = advance(s, ctx, rng);
      if (ev) beats.push(ev);
    }
    expect(s.evictionOrder).toContain(PLAYER);
    const goodbyes = beats.filter((b) => b.beat === "eviction-goodbye");
    expect(goodbyes.length).toBeGreaterThan(0); // the house's goodbyes to the player still play
    for (const g of goodbyes) expect(g.participants[1]).toBe(PLAYER);
  });

  it("the live adapter surfaces the goodbye decision (tones as options) and accepts the tone via `vote`", () => {
    const session = new GameSessionAdapter();
    session.createCharacter({ playerName: "P", seed: 2 });
    // Drive until the goodbye decision surfaces (resolving everything else first-legal).
    let pending: { kind: string; options: Array<{ id: string }> } | null = null;
    for (let i = 0; i < 3000 && !pending; i++) {
      const v = session.advanceGame();
      if (v.pending?.kind === "goodbye-message") { pending = v.pending; break; }
      if (v.pending) {
        const p = v.pending;
        if (p.kind === "nominations") session.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        else if (p.kind === "veto-decision") session.submitDecision({ kind: "veto-decision", use: false });
        else if (p.kind === "comp-intent") session.submitDecision({ kind: "comp-intent", intent: "compete" });
        else if (p.kind === "replacement") session.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
        else if (p.kind === "finale-statement" || p.kind === "juror-question") session.submitDecision({ kind: p.kind, statement: "x" });
        else if (p.kind === "finale-answer") session.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
        else session.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
      }
      if (v.finished) throw new Error("finished before a player goodbye surfaced");
    }
    expect(pending).not.toBeNull();
    expect(pending!.options.map((o) => o.id)).toEqual(["warm", "respectful", "cold"]);
    // An illegal tone is refused by the adapter mapping; a legal one resolves the decision.
    expect(() => session.submitDecision({ kind: "goodbye-message", vote: npc(1) })).toThrow(/tone/);
    const after = session.submitDecision({ kind: "goodbye-message", vote: "warm", statement: "see you on the outside" });
    expect(after.pending?.kind).not.toBe("goodbye-message");
  });
});

// --- E37: the player-juror question beat -----------------------------------------

/** A finale with TWO NPC finalists and the PLAYER on the jury panel. */
function playerJurorFinale(): { s: LiveSeasonState; ctx: SeasonCtx; A: EntityId; B: EntityId } {
  const A = npc(50), B = npc(51);
  const jury = [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6), npc(7), npc(8)];
  const rel = new RelationshipModel(0.5);
  for (const j of jury) {
    Object.assign(rel.edge(j, A), { trust: 0.5, affinity: 0.5, threat: 0.3 });
    Object.assign(rel.edge(j, B), { trust: 0.5, affinity: 0.5, threat: 0.3 });
  }
  const s: LiveSeasonState = { week: 9, beat: "finale", active: [A, B], vetoUsed: false, evictionOrder: [...jury], finished: false };
  return { s, ctx: ctxOf(rel), A, B };
}

describe("E37 — the player-juror asks their own finale question", () => {
  it("pauses once per finalist for the player-juror's question; the NPC answer stays engine-chosen", () => {
    const { s, ctx, A, B } = playerJurorFinale();
    const rng = new SeededRandom(5);
    const questioned: EntityId[] = [];
    for (let g = 0; g < 1000 && !s.finished; g++) {
      if (s.pending?.kind === "juror-question") {
        questioned.push(s.pending.finalist);
        const ev = applyDecision(s, { kind: "juror-question", question: "what was your game?" }, ctx);
        expect(ev.beat).toBe("finale");
        continue;
      }
      if (s.pending?.kind === "juror-vote") { applyDecision(s, { kind: "juror-vote", vote: s.pending.finalists[0] }, ctx); continue; }
      advance(s, ctx, rng);
    }
    // The player questioned BOTH finalists (the 18-Q&A symmetry holds for the juror's seat too).
    expect(questioned.sort()).toEqual([A, B].sort());
    // The finalists' answers to the player were engine-chosen and recorded for the tally.
    expect(s.finale!.appeals[A]?.[PLAYER]).toBeDefined();
    expect(s.finale!.appeals[B]?.[PLAYER]).toBeDefined();
    expect(s.finished).toBe(true);
  });

  it("is SCORELESS: different question text, identical reveals and winner (same seed)", () => {
    const run = (question: string): { winner: EntityId | undefined; reveals: string[] } => {
      const { s, ctx } = playerJurorFinale();
      const rng = new SeededRandom(42);
      const reveals: string[] = [];
      for (let g = 0; g < 1000 && !s.finished; g++) {
        if (s.pending?.kind === "juror-question") { applyDecision(s, { kind: "juror-question", question }, ctx); continue; }
        if (s.pending?.kind === "juror-vote") { applyDecision(s, { kind: "juror-vote", vote: s.pending.finalists[1] }, ctx); continue; }
        const ev = advance(s, ctx, rng);
        if (ev?.beat === "finale-reveal") reveals.push(`${ev.participants[0]}->${ev.participants[1]}`);
      }
      return { winner: s.winner, reveals };
    };
    const a = run("a long, pointed, devastating question");
    const b = run("x");
    expect(b.winner).toBe(a.winner);
    expect(b.reveals).toEqual(a.reveals);
  });
});
