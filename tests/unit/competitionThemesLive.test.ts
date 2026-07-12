import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER } from "../../src/domain/ids";
import { COMPETITION_THEMES } from "../../src/engine/competitionThemes";
import type { AdvanceView, CompetitionResultView, GameSession } from "../../src/ports/GameSession";
import type { UserSandbox } from "../../src/composition/registry";

/**
 * Feature 0125 — the competition theme layer, live through the adapter. Proves the theme surfaces on the
 * player-facing comp result, the flag-off path is the bare 0042 library, the result stays Vault-free, it is
 * seed-deterministic, and — the load-bearing guarantee — the seeded WINNER/eviction trajectory is
 * BYTE-IDENTICAL whether themes are on or off (the theme perturbs no roll). Roles only — no names.
 */

function resolveLegally(s: Pick<GameSession, "submitDecision">, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "houseguests-choice") s.submitDecision({ kind: "houseguests-choice", vote: p.options[0]!.id });
  else if (p.kind === "goodbye-message") s.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id } as never);
}

function newGame(user: string, seed: number, themesOn: boolean): UserSandbox {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  sb.session.setCompThemesEnabled(themesOn);
  return sb;
}

/** Play a seeded game, collecting every live comp result view + the final eviction order. */
function play(sb: UserSandbox, weeks = 5): { views: CompetitionResultView[]; evictionOrder: readonly string[] } {
  const s = sb.session;
  const views: CompetitionResultView[] = [];
  for (let i = 0; i < 240; i++) {
    const v = s.runCompetition({});
    if (v.started && v.winner) views.push(v);
    const a = s.advanceGame();
    if (a.pending) resolveLegally(s, a.pending);
    if (a.status.week > weeks || a.finished) break;
  }
  return { views, evictionOrder: sb.session.snapshot().live?.evictionOrder ?? [] };
}

describe("0125 — the seeded theme surfaces on the live competition result", () => {
  it("a resolved comp carries a theme label and a themed name/premise", () => {
    const sb = newGame("th-on", 31, true);
    const { views } = play(sb, 3);
    const themed = views.find((v) => v.theme);
    expect(themed, "at least one resolved comp surfaced a theme").toBeDefined();
    const labels = new Set(COMPETITION_THEMES.map((t) => t.label));
    expect(labels.has(themed!.theme!)).toBe(true);          // a real pool theme
    expect(themed!.name!.length).toBeGreaterThan(0);        // themed name present
    expect(themed!.narrative!.premise.length).toBeGreaterThan(0);
  });

  it("across a season the themed comps are visibly varied (not one repeated skin)", () => {
    const sb = newGame("th-variety", 31, true);
    const { views } = play(sb, 5);
    const themes = views.map((v) => v.theme).filter(Boolean);
    expect(new Set(themes).size).toBeGreaterThan(1); // real variety over the season
  });
});

describe("0125 — flag off is the bare 0042 library (no theme)", () => {
  it("with themes off, the result carries no theme field", () => {
    const sb = newGame("th-off", 31, false);
    const { views } = play(sb, 3);
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((v) => v.theme === undefined)).toBe(true);
  });
});

describe("0125 — the theme is a pure projection: the seeded spine is byte-identical on/off", () => {
  it("the same seed evicts the same houseguests in the same order whether themes are on or off", () => {
    const on = play(newGame("th-cal-on", 77, true), 6);
    const off = play(newGame("th-cal-off", 77, false), 6);
    // The winner each week (and thus the whole eviction trajectory) is untouched by the skin.
    expect(on.evictionOrder).toEqual(off.evictionOrder);
    expect(on.evictionOrder.length).toBeGreaterThan(0);
    // Same winners on each surfaced comp view, week for week — only the flavor differs.
    expect(on.views.map((v) => v.winner?.id)).toEqual(off.views.map((v) => v.winner?.id));
  });

  it("is seed-deterministic — the same seed reproduces the same themed sequence", () => {
    const a = play(newGame("th-det-a", 19, true), 4).views.map((v) => `${v.theme}:${v.name}`);
    const b = play(newGame("th-det-b", 19, true), 4).views.map((v) => `${v.theme}:${v.name}`);
    expect(a).toEqual(b);
  });
});

describe("0125 — the themed result is Vault-free", () => {
  it("no stat, score, ranking, or hidden number rides the themed competition result", () => {
    const sb = newGame("th-wall", 5, true);
    const { views } = play(sb, 4);
    const blob = JSON.stringify(views);
    expect(/"(physical|mental|social|trust|affinity|threat)"\s*:\s*[\d.]/.test(blob)).toBe(false);
    expect(/"scores"|"temperature"|"governing"|"ranking/i.test(blob)).toBe(false);
    expect(/SENTINEL/i.test(blob)).toBe(false);
    void PLAYER;
  });
});
