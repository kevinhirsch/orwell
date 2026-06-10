import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import { npc } from "../../src/domain/ids";

const PLAYER_NAME = "The Player";
function started(seed = 11): GameSessionAdapter {
  const s = new GameSessionAdapter();
  s.createCharacter({ playerName: PLAYER_NAME, seed });
  return s;
}

/** Resolve the standalone adapter's pending decision legally (drives a game forward in tests). */
function resolveLegally(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

/**
 * B37 / audit A1+A3 — ONE competition authority. runCompetition is no longer a second resolver: it
 * PREVIEWS the live loop's competition (which advanceGame crowns), reads the live house's own stats,
 * and refuses foreign/illegal references. HARD rule: roles only — no names.
 */
describe("runCompetition — single outcome authority (B37)", () => {
  it("on an unstarted game: not started, no winner", () => {
    const r = new GameSessionAdapter().runCompetition({ type: "physical" });
    expect(r.started).toBe(false);
    expect(r.winner).toBeNull();
  });

  it("returns a single engine-decided winner, never scores or rankings", () => {
    const r = started().runCompetition({ type: "physical" });
    expect(r.started).toBe(true);
    expect(r.winner).not.toBeNull();
    expect(Object.keys(r.winner!).sort()).toEqual(["id", "name"]);
    expect(r).not.toHaveProperty("scores");
  });

  it("PREVIEWS exactly the winner advanceGame then crowns (no second roll)", () => {
    const s = started(2); // a fresh game opens on the HOH competition beat
    const preview = s.runCompetition({ type: "physical" });
    s.advanceGame(); // B46: the player declares competition intent first
    const adv = s.submitDecision({ kind: "comp-intent", intent: "compete" }); // then the loop RESOLVES the HOH comp
    expect(adv.event!.beat).toBe("hoh-competition");
    expect(adv.status.hoh!.id).toBe(preview.winner!.id); // the same houseguest — one authority
  });

  it("reports the loop's competition type, ignoring the caller's requested type (foreign field)", () => {
    const r = started().runCompetition({ type: "banana-eating" });
    expect(["endurance", "mental", "physical", "puzzle", "social", "memory", "quiz"]).toContain(r.type);
  });

  it("ignores a caller participant subset — the loop's full eligible field is authoritative", () => {
    const s = started(2);
    const subset = s.runCompetition({ type: "mental", participantIds: [npc(1), npc(2)] });
    const full = s.runCompetition({ type: "mental" });
    expect(subset.winner!.id).toBe(full.winner!.id); // the subset did not change the outcome
  });

  it("refuses a caller reference to an unknown/evicted houseguest (winner null)", () => {
    const r = started().runCompetition({ participantIds: [npc(99)] }); // no such houseguest
    expect(r.winner).toBeNull();
  });

  it("never crowns an evicted houseguest — they are not in any eligibility pool", () => {
    const s = started(2);
    for (let i = 0; i < 600; i++) {
      const st = s.gameStatus();
      if (st.week >= 2 && st.phase === "hoh-competition") break; // a later HOH comp, after ≥1 eviction
      const adv = s.advanceGame();
      if (adv.pending) resolveLegally(s, adv.pending);
      if (adv.finished) break;
    }
    const evicted = new Set(s.snapshot().live!.evictionOrder);
    expect(evicted.size).toBeGreaterThan(0);
    const r = s.runCompetition({ type: "physical" });
    expect(r.winner).not.toBeNull();
    expect(evicted.has(r.winner!.id)).toBe(false);
  });

  it("is deterministic for a given game", () => {
    expect(started(5).runCompetition({ type: "puzzle" }).winner!.id)
      .toBe(started(5).runCompetition({ type: "puzzle" }).winner!.id);
  });

  it("the crowned win is recorded as a player-witnessed event and survives a restart", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("u");
    sb.session.createCharacter({ playerName: PLAYER_NAME, seed: 2 });
    const preview = sb.session.runCompetition({ type: "physical" });
    sb.session.advanceGame(); // B46: comp-intent pause
    sb.session.submitDecision({ kind: "comp-intent", intent: "compete" }); // crown the HOH — recorded via the registry's event sink
    const winName = preview.winner!.name;
    const hasWin = (r: GameSessionRegistry): boolean =>
      r.sandboxFor("u").engine.events.query().some((e) => !e.hidden && e.content.includes(winName) && /Head of Household/.test(e.content));
    expect(hasWin(reg)).toBe(true);

    // Restart: a fresh registry restored from the durable snapshot still holds the win.
    const reg2 = new GameSessionRegistry();
    reg2.restore("u", reg.snapshot("u"));
    expect(hasWin(reg2)).toBe(true);
  });
});
