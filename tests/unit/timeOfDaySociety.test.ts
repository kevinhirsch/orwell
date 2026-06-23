import { describe, it, expect, afterEach } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import type { AdvanceView, GameSession } from "../../src/ports/GameSession";
import { PLAYER } from "../../src/domain/ids";

/**
 * ADR 0006 — the SOCIAL half of the sleep economy: the awake set wired into the living house. As the
 * night thins, houseguests reach their character-driven bedtimes and drop out — the house empties for
 * the player (whereabouts), the approaches quiet down, and the off-screen society pairs only those
 * still up (the night owls scheme on; an early-to-bed houseguest misses it). OPT-IN: off ⇒ everyone
 * awake ⇒ byte-identical (the seeded juryReach/UAT calibration spine is unmoved). Roles only.
 */

afterEach(() => { delete process.env.ORWELL_TIME_OF_DAY; });

function resolveLegally(s: Pick<GameSession, "submitDecision">, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
  else if (p.kind === "houseguests-choice") s.submitDecision({ kind: "houseguests-choice", vote: p.options[0]!.id });
  else if (p.kind === "goodbye-message") s.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

/** Advance (clock on) until the phase reaches `target`; resolve pendings legally. Returns whether reached. */
function advanceToPhase(s: GameSessionAdapter, target: string, cap = 40): boolean {
  for (let i = 0; i < cap; i++) {
    if (s.gameStatus().timeOfDay === target) return true;
    const a = s.advanceGame();
    if (a.pending) resolveLegally(s, a.pending);
    if (a.finished) break;
  }
  return s.gameStatus().timeOfDay === target;
}

function npcsOf(s: GameSessionAdapter): string[] {
  return s.livingIds().filter((id) => id !== PLAYER);
}

function started(seed: number): GameSessionAdapter {
  const s = new GameSessionAdapter();
  s.createCharacter({ playerName: "The Player", seed });
  return s;
}

describe("ADR 0006 — off by default: the awake set is the identity (calibration-safe)", () => {
  it("awakeAmong returns the full set unchanged and the society occupancy keeps everyone", () => {
    const s = started(7); // ORWELL_TIME_OF_DAY unset
    for (let i = 0; i < 5; i++) { const a = s.advanceGame(); if (a.pending) resolveLegally(s, a.pending); }
    const ids = npcsOf(s);
    expect(s.awakeAmong(ids)).toEqual(ids); // identity, stable order — no calibration perturbation
    const occ = s.societyOccupancy();
    for (const id of ids) expect(occ?.has(id)).toBe(true); // nobody dropped from the society occupancy
  });
});

describe("ADR 0006 — the house thins at night (the social bound)", () => {
  it("by late hours the awake set is a STRICT subset and only ever shrinks", () => {
    process.env.ORWELL_TIME_OF_DAY = "1";
    let sawThinning = false;
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = started(seed);
      if (!advanceToPhase(s, "night")) continue;
      const ids = npcsOf(s);
      const awakeNight = new Set(s.awakeAmong(ids));
      expect(awakeNight.size).toBeLessThanOrEqual(ids.length);
      if (awakeNight.size < ids.length) {
        sawThinning = true;
        // monotonic: pushing into late-night only puts more people to bed — nobody re-wakes
        if (advanceToPhase(s, "late-night", 6)) {
          for (const id of s.awakeAmong(npcsOf(s))) expect(awakeNight.has(id)).toBe(true);
        }
        break;
      }
    }
    expect(sawThinning, "the house thinned at night for at least one cast").toBe(true);
  });

  it("whereabouts, approaches and the society occupancy only ever show houseguests who are awake", () => {
    process.env.ORWELL_TIME_OF_DAY = "1";
    const s = started(3);
    advanceToPhase(s, "night");
    const awake = new Set(s.awakeAmong(npcsOf(s)));
    const w = s.whereabouts();
    const around = [...(w?.present ?? []), ...(w?.nearby ?? []).flatMap((n) => n.present)];
    for (const p of around) expect(awake.has(p.id)).toBe(true); // no asleep NPC is "around" the player
    for (const a of s.socialInitiatives()) expect(awake.has(a.houseguest.id)).toBe(true); // none approach asleep
    const occ = s.societyOccupancy();
    for (const [id] of occ ?? new Map<string, string>()) if (id !== PLAYER) expect(awake.has(id)).toBe(true);
  });
});

describe("ADR 0006 — the off-screen society pairs only the awake (the night owls scheme on)", () => {
  it("no hidden off-screen scene at night involves a houseguest who has gone to bed", () => {
    process.env.ORWELL_TIME_OF_DAY = "1";
    let proved = false;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const reg = new GameSessionRegistry();
      const user = `society-${seed}`;
      const orch = new Orchestrator(reg, { now: () => seed }, { seed });
      const sb = reg.sandboxFor(user);
      sb.session.createCharacter({ playerName: "The Player", seed });
      if (!advanceToPhase(sb.session, "night")) continue;
      const npcs = npcsOf(sb.session);
      const awake = new Set(sb.session.awakeAmong(npcs));
      if (awake.size >= npcs.length) continue; // need at least one asleep for the check to bite
      const beforeIds = new Set(sb.engine.events.query().map((e) => e.id));
      for (let t = 0; t < 8; t++) orch.advance(user, "offscreen-tick");
      // The off-screen SOCIETY scenes are hidden pairwise events (witnessSet excludes the player). EXCLUDE
      // gossip: a `gossip` event is belief DIFFUSION along the social graph (0038), not a live paired scene
      // — a rumor can legitimately reach a houseguest who has since turned in (they learn it as it spreads),
      // so it is NOT awake-gated. The awake invariant here is about the society's real-time SCENES only
      // (ADR 0006), so scope to those; gossip diffusion has its own, separate model.
      const scenes = sb.engine.events.query().filter(
        (e) => !beforeIds.has(e.id) && e.hidden && e.witnessSet.length === 2 && e.type !== "gossip",
      );
      for (const e of scenes) {
        for (const id of e.witnessSet) {
          if (id !== PLAYER) expect(awake.has(id), "an asleep houseguest schemed off-screen at night").toBe(true);
        }
      }
      if (scenes.length > 0) { proved = true; break; }
    }
    expect(proved, "a late-night society ran among the awake, excluding the asleep").toBe(true);
  });
});
