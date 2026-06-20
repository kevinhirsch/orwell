import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { npc } from "../../src/domain/ids";

/**
 * F3 — the public status projection (`gameStatus()`, consumed by the FE status panel via
 * `GET /api/orwell/status`) must carry the over-signal + the broadcast winner. Before this, the
 * projection returned only ceremony facts (week/phase/HOH/nominees/veto/pending), so a client that
 * watches ONLY the status panel hung on the last ceremony state post-season — it could learn the
 * game ended only via `/state` or `/recap`. The fix adds `finished` + `winner` (the SAME public
 * over-signal + Vault-free broadcast winner the AdvanceView / SeasonRecap already expose).
 *
 * Vault Wall (mandate #2): `winner` is the broadcast season winner — a public, post-season fact the
 * whole house knows — NEVER any secret/Vault state. We plant Vault sentinels in the hidden layer and
 * prove none reach the projection.
 *
 * HARD testing rule: roles only — no fixture names.
 */

const SENTINEL = "SENTINEL-F3-hidden-state";

/** Plant Vault sentinels in the HIDDEN layer (an off-screen scene the player never witnessed + a
 *  sealed Vault record), so any leak into the status projection is caught. */
function plantHidden(sb: ReturnType<GameSessionRegistry["sandboxFor"]>, tag: string): void {
  sb.engine.events.record({
    id: `f3-hidden:${tag}`, ts: 9_000_000, type: "conversation",
    initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true,
    content: `${SENTINEL}-scene-${tag}`,
  });
  sb.engine.vault.writeHidden({ id: `f3-vault:${tag}`, kind: "hidden-attribute", content: `${SENTINEL}-vault-${tag}` });
}

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("F3 — gameStatus() carries finished + winner (public over-signal)", () => {
  it("before the finale: finished===false and winner===null", () => {
    const { sb } = liveGame("f3-pre", 7);
    const status = sb.session.gameStatus();
    expect(status.finished).toBe(false);
    expect(status.winner).toBeNull();
    // The existing ceremony facts are still present (no regression).
    expect(status).toHaveProperty("week");
    expect(status).toHaveProperty("phase");
    expect(status).toHaveProperty("veto");
    expect(status).toHaveProperty("pending");
  });

  it("pre-game (no character yet): finished===false and winner===null, never throws", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("f3-pregame");
    const status = sb.session.gameStatus();
    expect(status.finished).toBe(false);
    expect(status.winner).toBeNull();
  });

  for (const seed of [1, 7, 13, 42]) {
    it(`once the season is over: finished===true and winner is the broadcast winner name (seed ${seed})`, () => {
      const { sb } = liveGame(`f3-${seed}`, seed);
      plantHidden(sb, "before"); // sentinels live in the hidden layer across the whole drive

      const summary = sb.session.advanceToFinale();
      expect(summary.finished).toBe(true);
      expect(summary.winnerName).toBeTruthy();

      plantHidden(sb, "after");

      const status = sb.session.gameStatus();
      expect(status.finished).toBe(true);
      // The public winner is exactly the broadcast winner the recap reports (NAME only).
      expect(status.winner).not.toBeNull();
      expect(status.winner!.name).toBe(summary.winnerName);
      expect(status.winner!.name).toBeTruthy();

      // Vault Wall: the WHOLE projection is sentinel-free — no hidden scene or sealed record leaks.
      const blob = JSON.stringify(status);
      expect(blob).not.toContain(SENTINEL);
      expect(blob).not.toContain("vault");
    });
  }
});
