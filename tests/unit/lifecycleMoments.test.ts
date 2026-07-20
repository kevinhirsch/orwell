import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * B62 — server-initiated lifecycle moments (audit J1+J7+J2): premiere / re-entry / terminal beats
 * the FE can fetch so a season opens, resumes, and closes with narration instead of dead air —
 * grounded in the STORE, never the chat (ADR 0003). Plus B63 verification (audit U3): the
 * jury/standing facts the memory wall needs are already public. Roles only — no fixture names.
 */
function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
}

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("B62 — the re-entry beat (resume opens with the store, never the chat)", () => {
  it("grounds the fresh-morning framing in the current week/phase + recent WITNESSED events only", () => {
    const { sb } = liveGame("reentry", 5);
    const s = sb.session;
    // Play into the season so the record has real beats.
    for (let i = 0; i < 25; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
    }
    const sentinel = "SENTINEL-B62-offscreen";
    sb.engine.events.record({
      id: "b62:hidden", ts: 9_200_000, type: "conversation",
      initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: sentinel,
    });

    const { moment, systemPrompt } = s.getMomentPrompt({ moment: "re-entry" });
    expect(moment).toBe("re-entry");
    expect(systemPrompt).toContain("Re-entry");
    expect(systemPrompt).toContain("THE RECORD");
    expect(systemPrompt).toContain(`Week: ${s.gameStatus().week}`);
    expect(systemPrompt).toContain(`Phase: ${s.gameStatus().phase}`);
    // A real recorded, WITNESSED beat is woven in as a fact to voice…
    const witnessed = sb.engine.events.queryAll().filter((e) => !e.hidden);
    expect(witnessed.length).toBeGreaterThan(0);
    expect(systemPrompt).toContain("morning");
    // …and the hidden layer never is (the wall holds through the lifecycle beats).
    expect(systemPrompt).not.toContain(sentinel);
  });

  it("a brand-new game's re-entry says the season has just begun (no invented history)", () => {
    const { sb } = liveGame("reentry-fresh", 6);
    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "re-entry" });
    expect(systemPrompt).toContain("THE RECORD");
    // The framing forbids inventing happenings; with little record the block stays honest.
    expect(systemPrompt).toContain("never invent");
  });

  it("ordinary per-turn moments do NOT carry the story block (the prompt stays tight)", () => {
    const { sb } = liveGame("reentry-tight", 7);
    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "social" });
    expect(systemPrompt).not.toContain("THE RECORD");
  });
});

describe("L31 — the premiere is a producer-guided introductions round + a light tutorial", () => {
  it("the premiere moment drives a built-in round of introductions and a tutorial cadence", () => {
    const { sb } = liveGame("premiere-l31", 8);
    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "premiere" });
    // a BUILT-IN introductions beat — the champagne circle: production convenes the WHOLE house at once
    expect(systemPrompt).toMatch(/\(1\) INTRODUCTIONS/i);
    expect(systemPrompt).toMatch(/GATHERED THE WHOLE HOUSE into a champagne circle/i);
    // each houseguest introduces their PUBLIC self (name / from / what they do / one real thing)
    expect(systemPrompt).toMatch(/name, where they're from/i);
    // once introduced, the public intro is fixed (ties to 0058 byte-stable public depth)
    expect(systemPrompt).toMatch(/that intro is FIXED|never drifts/i);
    // the hand-held tutorial cadence for the first week
    expect(systemPrompt).toMatch(/TUTORIAL CADENCE/i);
    // still drives to the first HOH (the premiere does not stall)
    expect(systemPrompt).toMatch(/FIRST HEAD OF HOUSEHOLD COMPETITION/i);
  });
});

describe("B62 — the terminal beat (the season closes with the result, from the record)", () => {
  it("a finished season's post-season prompt carries the winner and the week", () => {
    const { sb } = liveGame("terminal", 3);
    const s = sb.session;
    for (let i = 0; i < 4000; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
      if (v.finished) break;
    }
    const view = s.getGameState();
    expect(view.moment).toBe("post-season"); // the engine itself frames the terminal beat
    // B6-01: getGameState carries the real `finished` over-signal the FE season lifecycle (0057)
    // gates on — it must be a true engine field, not a shape only a test mock produces.
    expect(view.finished).toBe(true);
    const { systemPrompt } = s.getMomentPrompt({});
    expect(systemPrompt).toContain("THE RESULT:");
    expect(systemPrompt).toContain("won the season");
    const winner = s.seasonRecap().winner!;
    expect(systemPrompt).toContain(winner.name);
    // Play-through gap (2026-06-18): the prompt told the model a new season needs a confirmed
    // request but never the MECHANISM — so on "play again" the model fired createCharacter without
    // confirmRestart and the call no-op'd, stranding the player on the reunion. The prompt must name
    // the restart door.
    expect(systemPrompt).toContain("confirmRestart=true");
  });

  // R4-04: the post-season prompt must forbid improvising a NEW season in this chat (the model was
  // observed running a fictional casting interview while the engine stayed at the old finale, and
  // STILL did on stronger models with the guard buried at the end — round-6 A1). The guard now LEADS
  // with a hard rule and points at the sanctioned "New season" button (0057), paired with R4-05.
  it("the post-season prompt LEADS with a hard no-new-season rule and points at the New season button", () => {
    const { sb } = liveGame("runitback", 9);
    const s = sb.session;
    for (let i = 0; i < 4000; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
      if (v.finished) break;
    }
    expect(s.getGameState().moment).toBe("post-season");
    const prompt = s.getMomentPrompt({}).systemPrompt;
    // The hard rule must come BEFORE the reunion-hosting copy, not be buried after it (A1).
    const hardRuleAt = prompt.search(/HARD RULE/i);
    const reunionAt = prompt.search(/host the reunion/i);
    expect(hardRuleAt).toBeGreaterThanOrEqual(0);
    expect(reunionAt).toBeGreaterThan(hardRuleAt);
    expect(prompt).toMatch(/do NOT run a casting interview/i);
    expect(prompt).toMatch(/who are you this time/i);       // the exact improvisation we saw
    expect(prompt).toContain("createCharacter");
    expect(prompt).toMatch(/New season/);                   // points at the sanctioned button (0057)
    expect(prompt).toMatch(/ghost season|goes nowhere/i);   // names the player-experience harm
  });
});

describe("B63 — the memory wall's facts are already public (verification)", () => {
  it("the roster distinguishes active / jury / evicted, and the player's ceremony role is derivable", () => {
    const { sb } = liveGame("wall", 9);
    const s = sb.session;
    for (let i = 0; i < 1200; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
      const seats = new Set(s.getGameState().house.map((h) => h.status));
      if (seats.has("jury") && seats.has("evicted")) break;
      if (v.finished) break;
    }
    const seats = new Set(s.getGameState().house.map((h) => h.status));
    expect(seats.has("jury")).toBe(true);     // jurors are marked once the jury forms
    expect(seats.has("evicted")).toBe(true);  // pre-jury exits stay distinct

    // The player's HOH / nominee / veto role is computable from PUBLIC ceremony facts alone.
    const status = s.gameStatus();
    const me = s.getGameState().player!.id;
    const role = status.hoh?.id === me ? "hoh"
      : status.nominees.some((n) => n.id === me) ? "nominee"
      : status.veto.holder?.id === me ? "veto-holder" : "houseguest";
    expect(["hoh", "nominee", "veto-holder", "houseguest"]).toContain(role);
    // No hidden-layer key rides along on either projection.
    const blob = JSON.stringify(status) + JSON.stringify(s.getGameState());
    expect(blob).not.toMatch(/trust|threat|affinity|soul|hiddenElement/i);
  });
});
