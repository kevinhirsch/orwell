import { describe, it, expect } from "vitest";
import {
  COMPETITION_LIBRARY, drawCompetition, competitionById, NO_REPEAT_WINDOW,
} from "../../src/engine/competitionLibrary";
import type { CompetitionPhase } from "../../src/engine/competitionLibrary";
import { resolveCompetition, CompetitionIntents, RELEVANT } from "../../src/domain/competitionOutcome";
import type { Competitor } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { GameSessionRegistry } from "../../src/composition/registry";
import { npc, PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0042 — the competition library. Roles only — no fixture names. The library supplies
 * structured variety + Vault-free narrative scaffolds; the ENGINE still decides every winner
 * (0006/0028 resolution math, unchanged).
 */

describe("the curated library (structure pinned, flavor free)", () => {
  it("ids are unique, both phases are stocked, and every scaffold is real content", () => {
    const ids = COMPETITION_LIBRARY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const phase of ["hoh", "veto"] as const) {
      expect(COMPETITION_LIBRARY.filter((d) => d.phase === phase).length).toBeGreaterThanOrEqual(3);
    }
    for (const d of COMPETITION_LIBRARY) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.narrative.premise.length).toBeGreaterThan(0);
      expect(d.narrative.beats.length).toBeGreaterThanOrEqual(2);
      expect(d.narrative.winReads.length).toBeGreaterThan(0);
    }
  });

  it("every def's declared governing aptitude IS the resolution map's stat for its type", () => {
    for (const d of COMPETITION_LIBRARY) {
      expect(d.governing, `${d.id} governing must match RELEVANT[${d.type}]`).toBe(RELEVANT[d.type]);
    }
  });

  it("no scaffold carries a stat, score, or number (Vault-free flavor only)", () => {
    const json = JSON.stringify(COMPETITION_LIBRARY.map((d) => d.narrative));
    expect(json).not.toMatch(/\d\.\d/);
    expect(json).not.toMatch(/"score|"stat|"trust|"threat|"affinity/i);
  });
});

describe("the seeded draw (variety, no immediate repeats, deterministic)", () => {
  const drawSeason = (phase: CompetitionPhase, seed: number, weeks = 12): string[] => {
    const rng = new SeededRandom(seed);
    const history: string[] = [];
    for (let w = 1; w <= weeks; w++) history.push(drawCompetition(phase, w, rng, history).id);
    return history;
  };

  it("a season draws more than one distinct competition per phase", () => {
    for (const phase of ["hoh", "veto"] as const) {
      expect(new Set(drawSeason(phase, 5)).size).toBeGreaterThan(1);
    }
  });

  it("the same competition is never drawn twice in immediate succession", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const trail = drawSeason("hoh", seed);
      for (let i = 1; i < trail.length; i++) expect(trail[i]).not.toBe(trail[i - 1]);
    }
    expect(NO_REPEAT_WINDOW).toBeGreaterThanOrEqual(1);
  });

  it("the draw is seed-deterministic and ids round-trip through the lookup", () => {
    expect(drawSeason("veto", 9)).toEqual(drawSeason("veto", 9));
    for (const d of COMPETITION_LIBRARY) expect(competitionById(d.id)).toBe(d);
    expect(competitionById("no-such-comp")).toBeUndefined();
  });
});

describe("resolution: the right aptitude governs, the engine still decides (0006 reused)", () => {
  const fieldFor = (governing: "physical" | "mental" | "social"): Competitor[] => {
    // A clear-but-calibrated favorite (the 0006 style): stronger in the governing aptitude,
    // weaker everywhere else — so the GOVERNING stat, not overall fitness, must decide.
    const strong: Competitor = { id: npc(1), stats: { physical: 0.4, mental: 0.4, social: 0.4 } };
    strong.stats[governing] = 0.75;
    const weak: Competitor = { id: npc(2), stats: { physical: 0.6, mental: 0.6, social: 0.6 } };
    weak.stats[governing] = 0.5;
    return [strong, weak];
  };

  it("each def's favorite (strong in the governing aptitude) wins a clear majority — with real upsets", () => {
    for (const def of COMPETITION_LIBRARY) {
      let wins = 0;
      const runs = 300;
      for (let i = 0; i < runs; i++) {
        const r = resolveCompetition(fieldFor(def.governing), def.type, new CompetitionIntents(), new SeededRandom(i + 1));
        if (r.winner === npc(1)) wins++;
      }
      expect(wins / runs, `${def.id}: the ${def.governing}-strong favorite`).toBeGreaterThan(0.55);
      expect(wins / runs, `${def.id}: upsets stay real`).toBeLessThan(0.95);
    }
  });

  it("the player is never protected: with identical stats they win no more than their share", () => {
    const def = COMPETITION_LIBRARY[0]!;
    const even = (id: EntityId): Competitor => ({ id, stats: { physical: 0.5, mental: 0.5, social: 0.5 } });
    let playerWins = 0;
    const runs = 600;
    for (let i = 0; i < runs; i++) {
      const r = resolveCompetition([even(PLAYER), even(npc(1)), even(npc(2)), even(npc(3))], def.type, new CompetitionIntents(), new SeededRandom(i + 7));
      if (r.winner === PLAYER) playerWins++;
    }
    expect(playerWins / runs).toBeGreaterThan(0.1); // a real participant…
    expect(playerWins / runs).toBeLessThan(0.4);    // …with no hidden favor (fair share ≈ 0.25)
  });
});

describe("live integration (the loop draws from the library)", () => {
  /** Play a seeded live game for a few weeks, auto-answering player decisions. */
  const play = (user: string, seed: number, weeks = 4): {
    history: { hoh: string[]; veto: string[] };
    vetoFieldSizes: number[];
    compViews: string;
  } => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor(user);
    const s = sb.session;
    s.createCharacter({ playerName: "The Player", seed });
    const vetoFieldSizes: number[] = [];
    const compViews: unknown[] = [];
    for (let i = 0; i < 200; i++) {
      compViews.push(s.runCompetition({}));
      const v = s.advanceGame();
      if (v.pending) {
        const p = v.pending;
        if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
        else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
        else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
      }
      const live = s.snapshot().live;
      if (live?.vetoField) vetoFieldSizes.push(live.vetoField.length);
      if (v.status.week > weeks || v.finished) break;
    }
    const live = s.snapshot().live!;
    return {
      history: live.compHistory ?? { hoh: [], veto: [] },
      vetoFieldSizes,
      compViews: JSON.stringify(compViews),
    };
  };

  it("a live season draws varied comps per phase with no immediate repeats — and is seed-deterministic", () => {
    const a = play("cl-live-a", 31);
    expect(a.history.hoh.length).toBeGreaterThanOrEqual(3);
    expect(new Set([...a.history.hoh, ...a.history.veto]).size).toBeGreaterThan(1);
    for (const phase of ["hoh", "veto"] as const) {
      const t = a.history[phase];
      for (let i = 1; i < t.length; i++) expect(t[i], `${phase} draw ${i}`).not.toBe(t[i - 1]);
    }
    const b = play("cl-live-b", 31);
    expect(b.history).toEqual(a.history); // same seed ⇒ same drawn season
  });

  it("eligibility holds under any drawn comp: the veto field is six players (0005)", () => {
    const { vetoFieldSizes } = play("cl-elig", 17, 3);
    expect(vetoFieldSizes.length).toBeGreaterThan(0);
    for (const n of vetoFieldSizes) expect(n).toBe(6);
  });

  it("the result view carries name + format + narrative and never a stat or score", () => {
    const { compViews } = play("cl-view", 23);
    // At least one live comp beat exposed the drawn def's flavor…
    expect(compViews).toMatch(/"name":/);
    expect(compViews).toMatch(/"format":/);
    expect(compViews).toMatch(/"premise":/);
    // …and nothing numeric or hidden crossed (the 0001 canary, extended to the enriched view).
    expect(compViews).not.toMatch(/"(physical|mental|social|trust|affinity|threat)"\s*:\s*\d/);
    expect(compViews).not.toMatch(/"scores"|"temperature"|"governing"/);
  });
});
