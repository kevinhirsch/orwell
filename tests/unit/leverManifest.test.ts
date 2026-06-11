import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_GAME_MASTER_PROMPT, buildSystemPrompt } from "../../src/engine/momentPrompts";
import { PLAYER_AGENT_LEVERS } from "../../src/surfaces/tools/registry";
import type { GameStateView } from "../../src/ports/GameSession";

// Feature 0018 / B21 — the base prompt's lever manifest must name EVERY game-driving player lever,
// enforced so the prompt and the tool registry can never silently drift apart.
describe("lever manifest ↔ registry (0018 drift guard)", () => {
  it("names every game-driving player lever (none missing from the manifest)", () => {
    const missing = PLAYER_AGENT_LEVERS.filter((name) => !BASE_GAME_MASTER_PROMPT.includes(name));
    expect(missing, `levers absent from the base prompt manifest: ${missing.join(", ")}`).toEqual([]);
  });

  it("includes the live-loop and social levers added since the original four", () => {
    for (const lever of ["advanceGame", "submitDecision", "socialInitiatives", "diaryRoom"]) {
      expect(PLAYER_AGENT_LEVERS).toContain(lever);
      expect(BASE_GAME_MASTER_PROMPT).toContain(lever);
    }
  });

  it("states the engine decides outcomes and the model only voices them", () => {
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/engine\s+decides/i);
    expect(BASE_GAME_MASTER_PROMPT.toLowerCase()).toContain("never invent");
  });

  it("a competition moment directs resolving through the engine, no inventing/scores", () => {
    const view = { started: true, week: 1, phase: "hoh-competition", moment: "hoh-competition",
      player: { id: "p", name: "P", archetype: "a", strategyStyle: "s" }, house: [] } as unknown as GameStateView;
    const prompt = buildSystemPrompt("hoh-competition", view).toLowerCase();
    expect(prompt).toContain("runcompetition");
    expect(prompt).toMatch(/no scores|never (choose|reveal)|only the/);
  });

  // P1 (audit 2026-06-10 / B61's missing "finality language"): the v1 §3.9 failure was the
  // narrator voicing unresolved outcomes as settled ("X is going home"). The line must exist.
  it("P1: forbids voicing unresolved outcomes as settled results", () => {
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/FINALITY\./);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/resolved AND revealed/i);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/never announce an unrevealed outcome as settled/i);
  });

  // P4: levers are silent production machinery — the model must never ask permission to pull
  // one, and ask_user is scoped to the engine's pending BINDING decisions only.
  it("P4: declares levers silent and scopes ask_user to pending binding decisions", () => {
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/SILENT production\s*machinery/i);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/never ask the player's permission/i);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/ask_user is ONLY for presenting the engine's\s*pending BINDING decision options/i);
  });

  // P6: runCompetition PREVIEWS the loop's already-decided winner; only advanceGame commits.
  // The old wording ("resolve a competition") let the model announce a never-committed winner.
  it("P6: the runCompetition bullet states preview semantics, with advanceGame the sole resolver", () => {
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/runCompetition — PREVIEW/);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/already decided/i);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/commits only when advanceGame resolves/i);
    expect(BASE_GAME_MASTER_PROMPT).toMatch(/never choose the winner yourself/i);
  });

  // P10: the submitDecision bullet must not enumerate a stale SUBSET of decision kinds (it
  // once named 4 of 11). The pending decision names its own kind; the manifest stays generic.
  // Drift-pinned against the real enum: the kind union on PendingDecisionView in the port.
  it("P10: the submitDecision bullet enumerates either no decision kinds or all of them", () => {
    const port = readFileSync(join(process.cwd(), "src/ports/GameSession.ts"), "utf-8");
    const m = port.match(/PendingDecisionView \{\s*\n\s*kind:([^;]+);/);
    expect(m, "PendingDecisionView kind union not found — update the P10 drift pin").toBeTruthy();
    const kinds = [...m![1]!.matchAll(/"([a-z-]+)"/g)].map((k) => k[1]!);
    expect(kinds.length).toBeGreaterThanOrEqual(8); // sanity: the real union, not a fragment

    const start = BASE_GAME_MASTER_PROMPT.indexOf("• submitDecision");
    const end = BASE_GAME_MASTER_PROMPT.indexOf("•", start + 1);
    const bullet = BASE_GAME_MASTER_PROMPT.slice(start, end === -1 ? undefined : end).toLowerCase();
    const named = kinds.filter((k) => bullet.includes(k.replace(/-/g, " ")) || bullet.includes(k));
    expect(
      named.length === 0 || named.length === kinds.length,
      `submitDecision names a stale subset of decision kinds: ${named.join(", ")} (of ${kinds.length})`,
    ).toBe(true);
    // …and it must still say the pending decision carries its kind + legal options.
    expect(bullet).toMatch(/kind/);
    expect(bullet).toMatch(/legal options/);
  });

  // P11: the prompt hands the model facts to voice, never example lines to recite (ADR 0003).
  it("P11: the cut example lines stay cut", () => {
    expect(BASE_GAME_MASTER_PROMPT).not.toContain("saw the trailer");
  });
});
