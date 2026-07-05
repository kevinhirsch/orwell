import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { renderGameContext } from "../../src/engine/momentPrompts";
import { voiceFingerprint } from "../../src/engine/voice";

/**
 * I6 distinct-voices fix (NARR-15 / PROMPT-2, 2026-07-05 pre-ship audit).
 *
 * Defect: the per-houseguest voice fingerprint (feature 0084 — how a houseguest TALKS) lived ONLY
 * behind the per-NPC `npcVoice` tool call, which the narrator reliably under-calls. The always-present
 * roster context the model reads EVERY turn (`renderGameContext`) carried only `demeanor` — so an
 * un-called houseguest voiced off a single demeanor phrase, and the cast homogenized.
 *
 * Fix: `HouseguestCard.voice` (a COMPACT, player-surface-SAFE clause rendered by `voiceFingerprint`
 * from the controlled voice DIAL vocabulary only) rides the live roster, so distinct cadence reaches
 * the model with no tool call. It is deliberately a rendered STRING — NOT the raw `VoiceProfile`
 * object — because the free-text signature/lexicon fields carry uncontrolled prose (a villain signature
 * "makes a threat sound like small talk", a "100%" filler) that would trip the coarse Vault-Wall
 * player-surface scan (`/trust|threat|affinity|soul/` + digits). The full fingerprint stays on
 * `npcVoice` (not a scanned surface) for a deep scene.
 *
 * Roles only — no fixture names.
 */
describe("I6 — roster carries a per-NPC voice fingerprint (structural, not a tool-call dependency)", () => {
  const start = (seed = 11) => {
    const s = new GameSessionAdapter();
    return { s, view: s.createCharacter({ playerName: "The Player", seed }) };
  };

  it("every active houseguest's roster CARD carries a non-empty `voice` fingerprint string", () => {
    const { view } = start();
    const active = view.house.filter((h) => h.status === "active");
    expect(active.length).toBeGreaterThan(0);
    for (const h of active) {
      expect(typeof h.voice).toBe("string");
      expect(h.voice!.length).toBeGreaterThan(0);
    }
  });

  it("the game CONTEXT the narrator reads every turn renders each houseguest's fingerprint — no npcVoice call needed", () => {
    const { view } = start(23);
    const ctx = renderGameContext(view);
    const active = view.house.filter((h) => h.status === "active" && h.voice);
    expect(active.length).toBeGreaterThan(0);
    for (const h of active) {
      const line = ctx.split("\n").find((l) => l.includes(`- ${h.name}`));
      expect(line).toBeTruthy();
      expect(line).toContain(h.voice);
    }
  });

  it("distinct houseguests read as distinct voices in the SAME context block (no homogenization)", () => {
    const { view } = start(42);
    const active = view.house.filter((h) => h.status === "active" && h.voice).slice(0, 6);
    expect(active.length).toBeGreaterThanOrEqual(4);
    // Real spread, not one flattened "warm professional" voice.
    expect(new Set(active.map((h) => h.voice)).size).toBeGreaterThan(1);
  });

  it("the fingerprint is DERIVED from the public voice profile (the same VoiceProfile npcVoice exposes)", () => {
    const { s, view } = start(5);
    const active = view.house.find((h) => h.status === "active" && h.voice)!;
    expect(active).toBeTruthy();
    // npcVoice() carries the FULL public VoiceProfile object; the roster clause is its safe rendering.
    const full = s.npcVoice(active.id)?.persona.voice;
    expect(full).toBeTruthy();
    expect(active.voice).toBe(voiceFingerprint(full!));
  });

  it("VAULT WALL — the roster fingerprint carries NO hidden-layer word and NO number, even when the source signature does", () => {
    // The villain signature pool includes "makes a threat sound like small talk"; the lexicon pool
    // includes "100%". Neither may reach the player-facing clause. This mirrors the BDD 0038 scan.
    for (const seed of [1, 11, 23, 42, 99, 123]) {
      const { view } = start(seed);
      for (const h of view.house) {
        if (!h.voice) continue;
        expect(h.voice, `voice clause leaked a hidden-layer word (seed ${seed})`).not.toMatch(/trust|threat|affinity|soul/i);
        expect(h.voice, `voice clause leaked a number (seed ${seed})`).not.toMatch(/[0-9]/);
      }
    }
  });

  it("VAULT WALL — the whole player-visible GameStateView serialization stays clear of the hidden-layer scan", () => {
    // Exactly the coarse guard the 0038 BDD scenarios apply to the player surface.
    for (const seed of [1, 42, 99]) {
      const { view } = start(seed);
      const blob = JSON.stringify(view);
      expect(blob, `player surface tripped the hidden-layer scan (seed ${seed})`).not.toMatch(/trust|threat|affinity|soul/i);
    }
  });

  it("the fingerprint is byte-stable across reads (voice is identity — it never drifts turn to turn)", () => {
    const { s } = start(31);
    const a = s.getGameState().house.map((h) => h.voice);
    const b = s.getGameState().house.map((h) => h.voice);
    expect(a).toEqual(b);
  });
});
