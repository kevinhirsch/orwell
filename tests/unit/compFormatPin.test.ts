import { describe, it, expect } from "vitest";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { RelationshipModel } from "../../src/engine/relationships";
import type { Stats } from "../../src/engine/season";
import {
  newLiveSeason, advance, applyDecision, validateCompetitionFiction, competitionPresentation,
  type LiveSeasonState, type SeasonCtx, type CompetitionPresentation,
} from "../../src/engine/liveSeason";

/**
 * L-F4 (#1743) — the comp presentation (format + premise) is PINNED across a competition's rounds.
 *
 * The engine decides the winner (`runCompetition`); the comp's PRESENTATION was model-authored and was
 * NOT held stable turn to turn — the Week-1 HOH comp narrated as "Piece by Piece" (a puzzle) on one beat
 * and "Center-Ring Trivia" (a quiz) the next, a full FORMAT flip-flop within one event. This proves the
 * fix: `competitionPresentation` — the single engine-side pin the ground truth surfaces on EVERY comp
 * beat — reports the SAME format + premise on the first reveal AND on every staged elimination round,
 * so the narrator can never re-author "what kind of comp this is". HARD rule: roles only — no names.
 */

/** A seeded house: balanced stats + a seeded relationship graph (mirrors stagedTrajectoryNeutral). */
function buildHouse(size: number, seed: number): { active: EntityId[]; ctx: SeasonCtx } {
  const rng = new SeededRandom(seed);
  const active: EntityId[] = [PLAYER, ...Array.from({ length: size - 1 }, (_, i) => npc(i + 1))];
  const stats = new Map<EntityId, Stats>();
  for (const id of active) stats.set(id, { physical: rng.next(), mental: rng.next(), social: rng.next() });
  const rel = new RelationshipModel(0.5);
  for (const a of active) for (const b of active) {
    if (a === b) continue;
    const e = rel.edge(a, b);
    e.trust = rng.next(); e.affinity = rng.next(); e.threat = rng.next(); e.confidence = 0.5;
  }
  return { active, ctx: { player: PLAYER, statsOf: (id) => stats.get(id)!, rel } };
}

/**
 * Drive the live season, capturing the pinned presentation of the FIRST staged competition — every beat
 * from the moment it stages (winner + drop order fixed) through its crown. Answers each `comp-round`
 * pending "compete" so the staged reveals play out. Stops once that first comp has crowned.
 */
function presentationsAcrossFirstComp(
  active: EntityId[], ctx: SeasonCtx, seed: number,
): { comp: "hoh-competition" | "veto-competition"; seen: CompetitionPresentation[] } {
  const s: LiveSeasonState = newLiveSeason(active);
  const rng = new SeededRandom(seed);
  const seen: CompetitionPresentation[] = [];
  let compKind: "hoh-competition" | "veto-competition" | undefined;
  let sawStaged = false;
  for (let guard = 0; guard < 5_000 && !s.finished; guard++) {
    if (s.pending) {
      const p = s.pending;
      if (p.kind === "comp-round" || p.kind === "comp-intent") applyDecision(s, { kind: p.kind, intent: "compete" }, ctx, rng);
      else if (p.kind === "nominations") applyDecision(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx);
      else if (p.kind === "veto-decision") applyDecision(s, { kind: "veto-decision", use: false }, ctx);
      else if (p.kind === "houseguests-choice") applyDecision(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng);
      else break; // reached beyond the first comp's ceremonies — nothing more to capture
    } else {
      advance(s, ctx, rng);
    }
    // Capture the pin whenever a STAGED comp is live (winner + drop order fixed) — the beats the finding
    // spans. `competitionPresentation` is null before the comp stages (the HOH def isn't drawn yet).
    if (s.competition) {
      const pin = competitionPresentation(s);
      if (pin) {
        compKind ??= pin.comp;
        if (pin.comp === compKind) { seen.push(pin); sawStaged = true; }
      }
    } else if (sawStaged) {
      break; // the first staged comp has crowned — we have its whole run
    }
  }
  return { comp: compKind!, seen };
}

describe("L-F4 (#1743) — the comp format/premise is pinned across a competition's rounds", () => {
  for (const [size, seed] of [[12, 7], [12, 42], [8, 3], [16, 1]] as const) {
    it(`size ${size}, seed ${seed}: format + premise are stable and present on every comp beat`, () => {
      const h = buildHouse(size, seed);
      const { seen } = presentationsAcrossFirstComp(h.active, h.ctx, seed);

      // The comp genuinely staged into MULTIPLE beats (the finding is a turn-TO-turn flip, so we must
      // have seen it re-surface at least twice).
      expect(seen.length, "the staged comp must surface across multiple beats").toBeGreaterThanOrEqual(2);

      // Every beat carries a NON-EMPTY format + premise (the pin is present, not just consistent).
      for (const p of seen) {
        expect(p.format, "each comp beat must carry a format").toBeTruthy();
        expect(p.premise.trim().length, "each comp beat must carry a premise").toBeGreaterThan(0);
      }

      // THE LITMUS: the format + premise are BYTE-IDENTICAL across every beat of the one competition —
      // no re-authoring "what kind of comp this is" turn to turn.
      const formats = new Set(seen.map((p) => p.format));
      const premises = new Set(seen.map((p) => p.premise));
      expect(formats.size, "the format must not flip-flop across the comp's rounds").toBe(1);
      expect(premises.size, "the premise must not flip-flop across the comp's rounds").toBe(1);
    });
  }

  it("the HARD format pin: the #1400 authored fiction can never rename the format, and its premise is immutable", () => {
    const h = buildHouse(12, 5);
    const s: LiveSeasonState = newLiveSeason(h.active);
    const rng = new SeededRandom(5);
    // Drive to a RESOLVED staged HOH comp (winner + drop order fixed) so a fiction write-back is legal.
    for (let guard = 0; guard < 200 && !(s.competition && s.competition.winner !== undefined && s.competition.dropOrder); guard++) {
      if (s.pending?.kind === "comp-round" || s.pending?.kind === "comp-intent") {
        applyDecision(s, { kind: s.pending.kind, intent: "compete" }, h.ctx, rng);
      } else if (!s.pending) {
        advance(s, h.ctx, rng);
      } else break;
    }
    const c = s.competition!;
    expect(c.winner, "the comp must have resolved for this test").toBeDefined();

    const floor = competitionPresentation(s)!;
    const pinnedFormat = floor.format;

    // The model authors its own theme + premise + per-drop fiction MATCHED to the fixed drop order.
    const authored = {
      comp: c.comp, week: s.week, theme: "A Model-Invented Theme",
      premise: "a wholly different, model-authored premise",
      eliminations: c.dropOrder!.map((id) => ({ id, fiction: `${id} goes out` })),
    };
    const v = validateCompetitionFiction(s, authored);
    expect(v.ok, "the drop-order-matched fiction must validate").toBe(true);
    if (v.ok) s.competitionFiction = v.fiction;

    const withFiction = competitionPresentation(s)!;
    // The authored PREMISE flows through (the open set — the model may invent the flavor)...
    expect(withFiction.premise).toBe("a wholly different, model-authored premise");
    expect(withFiction.authored).toBe(true);
    // ...but the FORMAT is the HARD pin: it is ALWAYS the drawn library format, never model-overridable.
    expect(withFiction.format, "the format is never overridable by authored fiction").toBe(pinnedFormat);

    // The authored premise is IMMUTABLE until crown — a second author attempt is REJECTED (already-authored),
    // the analogue of the winner-rename rejection, so later rounds can never render a different premise.
    const second = validateCompetitionFiction(s, { ...authored, premise: "yet another premise" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already-authored");
    expect(competitionPresentation(s)!.premise, "the pinned premise stands").toBe("a wholly different, model-authored premise");
  });

  it("no pin before a def is drawn (the HOH comp before it stages), and off a comp beat", () => {
    const h = buildHouse(8, 2);
    const s: LiveSeasonState = newLiveSeason(h.active);
    const rng = new SeededRandom(2);
    // First advance surfaces the HOH comp-round pending — the def is NOT drawn until it resolves.
    advance(s, h.ctx, rng);
    expect(s.pending?.kind, "the HOH comp-round is pending").toBe("comp-round");
    expect(competitionPresentation(s), "no format/premise exists before the HOH comp stages").toBeNull();
  });
});
