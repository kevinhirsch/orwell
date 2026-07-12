import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { requiredLeverForPhase, CLOSED_SET_ADVANCE_PHASES } from "../../src/engine/momentPrompts";
import type { AdvanceView } from "../../src/ports/GameSession";

/**
 * #1411 — the engine SIGNALS the single closed-set lever a beat requires (`GameStateView.requiredLever`),
 * replacing the FE-held beat→lever map (`_FORCE_COMP_PHASES ∪ _FORCE_ADVANCE_PHASES`) that could drift
 * from the tool registry. This pins:
 *   • the pure phase→lever function is EXACTLY the retired FE literal (byte-identity / golden-neutral);
 *   • the projection carries `requiredLever = "advanceGame"` IFF the live `phase` is a closed-set beat,
 *     and OMITS it on every open/social/premiere/finale beat (absent ⇒ no forcing ⇒ byte-identical);
 *   • Vault-freedom — a lever NAME only, never `submitDecision`, never a number/secret.
 * Roles only — no fixture names asserted.
 */

// The five deterministic comp/ceremony/eviction beats — the ONLY beats where exactly one engine-owned
// lever (advanceGame) is legal. This literal is the byte-identity anchor with the FE's retired sets
// (`_FORCE_COMP_PHASES = {hoh-competition, veto-competition}` ∪ `_FORCE_ADVANCE_PHASES =
// {nominations, veto-ceremony, eviction}`); if it ever changes, the golden fixture must be re-recorded.
const CLOSED_SET = ["hoh-competition", "veto-competition", "nominations", "veto-ceremony", "eviction"];
// Beats with NO single forceable lever — spontaneous calling stays primary (the FE never forced these).
const OPEN_SET = ["premiere", "finale", "final-eviction", "twist-reveal", "setup", "complete", "social",
  "character-creation", "jury", "post-season", "", "  "];

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
}

describe("#1411 requiredLeverForPhase — the pure phase→lever function", () => {
  it("returns advanceGame for EXACTLY the five closed-set beats, null for everything else", () => {
    for (const phase of CLOSED_SET) expect(requiredLeverForPhase(phase)).toBe("advanceGame");
    for (const phase of OPEN_SET) expect(requiredLeverForPhase(phase)).toBeNull();
  });

  it("the closed-set is EXACTLY the retired FE force literal (the byte-identity / golden anchor)", () => {
    expect([...CLOSED_SET_ADVANCE_PHASES].sort()).toEqual([...CLOSED_SET].sort());
  });

  it("is case-insensitive and null-safe (never throws, mirrors the FE `.lower()`)", () => {
    expect(requiredLeverForPhase("HOH-Competition")).toBe("advanceGame");
    expect(requiredLeverForPhase("EVICTION")).toBe("advanceGame");
    expect(requiredLeverForPhase(undefined as unknown as string)).toBeNull();
    expect(requiredLeverForPhase(null as unknown as string)).toBeNull();
  });

  it("NEVER names submitDecision — no phase yields the player's binding pick as a forceable lever", () => {
    for (const phase of [...CLOSED_SET, ...OPEN_SET]) {
      expect(requiredLeverForPhase(phase)).not.toBe("submitDecision");
    }
  });
});

describe("#1411 GameStateView.requiredLever — the engine-signaled force directive", () => {
  it("is ABSENT pre-game and at premiere (no closed-set beat ⇒ nothing to force)", () => {
    const s = new GameSessionAdapter();
    // Pre-game: the casting view carries no requiredLever.
    expect(s.getGameState().requiredLever).toBeUndefined();
    s.createCharacter({ playerName: "P", archetype: "social", seed: 81000 });
    // Premiere (before the first HOH): still no forceable beat.
    expect(s.getGameState().phase).toBe("premiere");
    expect(s.getGameState().requiredLever).toBeUndefined();
  });

  it("carries requiredLever='advanceGame' IFF the live phase is a closed-set beat, absent otherwise — at EVERY step of a real season", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", archetype: "social", seed: 81000 });
    let sawClosedSet = false;
    let sawOpenSet = false;
    // Drive a good stretch of the season; assert the projection invariant on every board we observe.
    for (let i = 0; i < 200; i++) {
      const v = s.advanceGame();
      if (v.pending) resolve(s, v.pending);
      const view = s.getGameState();
      const phase = view.phase;
      const inClosedSet = CLOSED_SET.includes(phase);
      if (inClosedSet) {
        // The beat's single legal lever the engine names — always advanceGame, never a secret/number.
        expect(view.requiredLever).toBe("advanceGame");
        sawClosedSet = true;
      } else {
        // Open/social/premiere/finale beat ⇒ the field is OMITTED (byte-identical / no forcing).
        expect(view.requiredLever).toBeUndefined();
        sawOpenSet = true;
      }
      if (view.finished) break;
    }
    // The sentinel proves BOTH branches were actually exercised (a season really passes through both).
    expect(sawClosedSet).toBe(true);
    expect(sawOpenSet).toBe(true);
  });

  it("names requiredLever even while a player pending is OPEN at a closed-set beat (pending suppression is the FE gate's separate job, not this projection)", () => {
    // The retired FE map was phase-only too — it said advanceGame at a comp phase regardless of the open
    // pending, and the FE's own `pending_open` check did the suppressing. Signaling EXACTLY what the map
    // picked means requiredLever stays phase-derived here; forcing is still suppressed FE-side. The
    // literal case the #1319 root cause names is the round-1 `comp-round` binding pick at a comp beat.
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", archetype: "social", seed: 81000 });
    for (let i = 0; i < 50; i++) {
      const v = s.advanceGame();
      if (v.pending && v.pending.kind === "comp-round") {
        // An open player pending at the hoh/veto competition beat: the phase is the comp beat, so the
        // engine still names advanceGame (a lever name only — never the player's submitDecision).
        const view = s.getGameState();
        expect(CLOSED_SET).toContain(view.phase);
        expect(view.requiredLever).toBe("advanceGame");
        return;
      }
      if (v.pending) resolve(s, v.pending);
    }
    throw new Error("expected to reach a comp-round pending within the first HOH");
  });
});
