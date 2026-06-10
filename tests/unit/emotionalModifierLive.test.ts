import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { evolveEmotion } from "../../src/engine/emotionalArc";
import type { Soul } from "../../src/engine/characterFactory";
import { resolveCompetition, CompetitionIntents } from "../../src/domain/competitionOutcome";
import { RELATIONSHIP_CONSTANTS } from "../../src/engine/relationshipConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { AdvanceView, SubmitDecisionReq } from "../../src/ports/GameSession";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature B51 (audit D2) — the soul emotional modifier, finally LIVE on competitions. The Luck-
 * replacement ADR (0006/0028) was structurally zero on every live comp; 0041 wired `emotionalOf`
 * into `winnerOf`, and this closes the gaps: going on the block RATTLES a houseguest (their veto odds
 * dip below their calm baseline) and untended relationships DECAY toward baseline on week rollover (C5).
 * HARD rule: roles only — no names.
 */

const calmSoul = (): Soul => ({ emotionalBaseline: 0.5, volatility: 0.6, emotionalState: 0.5, emotionalHistory: [], memory: [] });

/** A simple, deterministic player policy: compete, take the first legal options, never use the veto. */
function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  const submit = (req: SubmitDecisionReq): void => void s.submitDecision(req);
  if (p.kind === "nominations") submit({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") submit({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") submit({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-intent") submit({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") submit({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") submit({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") submit({ kind: "juror-vote", vote: p.options[0]!.id });
  else submit({ kind: p.kind, vote: p.options[0]!.id });
}

describe("B51 — being nominated rattles a houseguest into the veto", () => {
  it("the 'nominated' event lowers the soul's emotional state below its calm baseline", () => {
    const soul = calmSoul();
    evolveEmotion(soul, "nominated");
    expect(soul.emotionalState).toBeLessThan(0.5);
  });

  it("a rattled (nominated) competitor wins the veto MEASURABLY less than at their calm baseline", () => {
    // Head-to-head, equal stats: the only difference is the emotional modifier (0028, weight 0.2).
    const winRate = (emotionalState: number, runs = 1500): number => {
      const stats = { physical: 0.5, mental: 0.5, social: 0.5 };
      let wins = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const field = [{ id: npc(1), stats, emotionalState }, { id: npc(2), stats, emotionalState: 0.5 }];
        if (resolveCompetition(field, "social", new CompetitionIntents(), new SeededRandom(seed)).winner === npc(1)) wins++;
      }
      return wins / runs;
    };
    const soul = calmSoul();
    evolveEmotion(soul, "nominated");
    const rattled = winRate(soul.emotionalState);
    const baseline = winRate(0.5);
    expect(baseline).toBeGreaterThan(0.45); // even field ⇒ ~half at baseline
    expect(rattled).toBeLessThan(baseline);  // on the block, they go into the veto on the back foot
  });

  it("LIVE: the nominees' emotional state drops below baseline once the nomination ceremony resolves", () => {
    // Drive the live loop to a nomination ceremony and read the nominees' (hidden) souls.
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("u-nom");
    sb.session.createCharacter({ playerName: "P", seed: 7 });
    let nominees: EntityId[] = [];
    for (let i = 0; i < 40; i++) {
      const v = sb.session.advanceGame();
      if (v.pending) resolve(sb.session, v.pending);
      if (v.event?.beat === "nominations") { nominees = sb.session.snapshot().live!.nominees!; break; }
    }
    expect(nominees.length).toBe(2);
    const souls = sb.session.snapshot().house!.npcs;
    for (const nom of nominees) {
      if (nom === PLAYER) continue; // the player can be a nominee too; assert on the NPC souls we can read
      const soul = souls.find((n) => n.id === nom)!.soul;
      expect(soul.emotionalState).toBeLessThan(0.5); // rattled by going up
    }
  });
});

describe("B51 / audit C5 — untended relationships decay toward baseline on week rollover", () => {
  it("a season of week rollovers pulls extreme, untended edges back toward the neutral baseline", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("u-decay");
    sb.session.createCharacter({ playerName: "P", seed: 2 });
    const rel = sb.engine.relationships;
    const npcs = sb.session.getGameState().house.map((h) => h.id);
    // Pin every NPC→NPC trust to an extreme; with nothing refreshing them, decay should erode it.
    for (const a of npcs) for (const b of npcs) if (a !== b) rel.edge(a, b).trust = 0.9;

    // Drive ~4 week rollovers (each eviction-result triggers the decay).
    let rollovers = 0;
    for (let i = 0; i < 400 && rollovers < 4; i++) {
      const v = sb.session.advanceGame();
      if (v.pending) resolve(sb.session, v.pending);
      if (v.event?.beat === "eviction-result") rollovers++;
      if (v.finished) break;
    }
    expect(rollovers).toBeGreaterThanOrEqual(3);

    // The mean of the surviving pinned edges has eroded toward 0.5 (decay), not stayed at 0.9.
    const survivors = sb.session.snapshot().live!.active.filter((id) => id !== PLAYER);
    const vals: number[] = [];
    for (const a of survivors) for (const b of survivors) if (a !== b) vals.push(rel.edge(a, b).trust);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(mean).toBeLessThan(0.88); // measurably decayed from the pinned 0.9
    expect(mean).toBeGreaterThan(0.5); // slow — grudges/bonds fade but don't vanish in a few weeks
  });

  it("DECAY_RATE is the single tunable for the rollover decay (constants module, not inline)", () => {
    expect(RELATIONSHIP_CONSTANTS.DECAY_RATE).toBeGreaterThan(0);
    expect(RELATIONSHIP_CONSTANTS.DECAY_RATE).toBeLessThan(0.5); // slow by design
  });
});

describe("B51 — the live emotional arc is deterministic and durable", () => {
  it("same seed ⇒ identical emotional trajectory; snapshot/restore preserves the states", () => {
    const play = (seed: number): GameSessionAdapter => {
      const s = new GameSessionAdapter();
      s.createCharacter({ playerName: "P", seed });
      for (let i = 0; i < 30; i++) {
        const v = s.advanceGame();
        if (v.pending) resolve(s, v.pending);
        if (v.finished) break;
      }
      return s;
    };
    const a = play(5);
    const b = play(5);
    const arcOf = (s: GameSessionAdapter): string =>
      JSON.stringify(s.snapshot().house!.npcs.map((n) => [n.soul.emotionalState, n.soul.emotionalHistory]));
    expect(arcOf(b)).toBe(arcOf(a)); // deterministic trajectory

    // Snapshot → restore preserves every soul's emotional state + history (0030).
    const restored = new GameSessionAdapter();
    restored.restore(a.snapshot());
    expect(arcOf(restored)).toBe(arcOf(a));
  });
});
