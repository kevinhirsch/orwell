import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { InMemoryGameStateRepository } from "../../src/adapters/inmemory/InMemoryGameStateRepository";
import { AdminPort } from "../../src/surfaces/admin/AdminPort";
import { ADMIN_TOOLS, PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * L38 — the God-Mode "fast-forward to finale (debug)" lever. It DRIVES the deterministic engine to a
 * crowned winner (auto-resolving the player's pendings with legal defaults) so the post-season Vault
 * retrospective (0048) can unseal legitimately. The non-negotiable constraint (mandate #2 / 0016):
 * God Mode reads NO Vault and reveals nothing hidden — the lever only makes the season FINISH.
 *
 * HARD testing rule: roles only — no fixture names.
 */

const SENTINEL = "SENTINEL-L38-hidden-state";

/** Plant Vault sentinels in the game's HIDDEN layer (an off-screen scene the player never witnessed
 *  + the engine's sealed records), so any leak into the fast-forward summary is caught. */
function plantHidden(sb: ReturnType<GameSessionRegistry["sandboxFor"]>, tag: string): void {
  sb.engine.events.record({
    id: `ff-hidden:${tag}`, ts: 9_000_000, type: "conversation",
    initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true,
    content: `${SENTINEL}-scene-${tag}`,
  });
  sb.engine.vault.writeHidden({ id: `ff-vault:${tag}`, kind: "hidden-attribute", content: `${SENTINEL}-vault-${tag}` });
}

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("L38 — advanceToFinale drives the live season to a crowned winner", () => {
  // Several mid-season states + seeds: from a FRESH live game the lever always reaches a finished
  // season (a crown) or a player-eviction terminal — never throws, never hangs.
  for (const seed of [1, 7, 13, 42, 101]) {
    it(`reaches a crowned winner without throwing (seed ${seed})`, () => {
      const { sb } = liveGame(`ff-${seed}`, seed);
      const summary = sb.session.advanceToFinale();
      expect(summary.finished).toBe(true);
      expect(summary.started).toBe(true);
      expect(summary.winnerName).toBeTruthy();        // a winner is genuinely crowned
      expect(summary.weeks).toBeGreaterThan(0);
      expect(["winner", "runner-up", "jury", "evicted"]).toContain(summary.playerPlacement);
      // The terminal state is real: the retrospective gate now opens (it stayed shut while live).
      expect(sb.session.seasonRetrospective()).not.toBeNull();
    });
  }

  it("partway through a season (player already played some beats), it still finishes", () => {
    const { sb } = liveGame("ff-midseason", 5);
    // Advance a few beats first, auto-resolving any pending so we're genuinely mid-season.
    for (let i = 0; i < 12; i++) {
      const v = sb.session.advanceGame();
      if (v.finished) break;
      if (v.pending) {
        const p = v.pending;
        if (p.kind === "nominations") sb.session.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        else if (p.kind === "veto-decision") sb.session.submitDecision({ kind: "veto-decision", use: false });
        else if (p.kind === "comp-intent") sb.session.submitDecision({ kind: "comp-intent", intent: "compete" });
        else if (p.options[0]) sb.session.submitDecision({ kind: p.kind, vote: p.options[0].id } as never);
      }
    }
    const summary = sb.session.advanceToFinale();
    expect(summary.finished).toBe(true);
    expect(summary.winnerName).toBeTruthy();
  });

  it("is a no-op (not started) before a game exists — never throws", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("ff-pregame");
    const summary = sb.session.advanceToFinale();
    expect(summary.started).toBe(false);
    expect(summary.finished).toBe(false);
    expect(summary.winnerName).toBeNull();
  });

  it("an already-finished season is idempotent — finishes again with the same crown", () => {
    const { sb } = liveGame("ff-idem", 9);
    const first = sb.session.advanceToFinale();
    const second = sb.session.advanceToFinale();
    expect(first.finished).toBe(true);
    expect(second.finished).toBe(true);
    expect(second.winnerName).toBe(first.winnerName);
    expect(second.weeks).toBe(first.weeks);
  });
});

describe("L38 — the Vault Wall holds: the fast-forward summary leaks NO hidden state", () => {
  it("plants Vault sentinels and proves none appear in the returned summary", () => {
    const { sb } = liveGame("ff-sentinel", 3);
    plantHidden(sb, "before");
    const summary = sb.session.advanceToFinale();
    plantHidden(sb, "after"); // sentinels both before and after the drive — neither may surface
    // The summary carries only public ceremony facts (winner NAME, weeks, placement).
    const blob = JSON.stringify(summary);
    expect(blob).not.toContain(SENTINEL);
    expect(blob).not.toContain("vault");
    expect(summary.finished).toBe(true);
    expect(summary.winnerName).toBeTruthy();
    // Every hidden event/vault record content stays out of the summary.
    const hidden = sb.engine.events.query().filter((e) => e.hidden).map((e) => e.content);
    for (const c of hidden) expect(blob.includes(c)).toBe(false);
  });

  it("the lever does NOT bypass the retrospective gate — it stays shut WHILE live, opens only after", () => {
    const { sb } = liveGame("ff-gate", 11);
    plantHidden(sb, "gate");
    // While live, the retrospective is null (the gate is the terminal state, in code — unchanged).
    expect(sb.session.seasonRetrospective()).toBeNull();
    const summary = sb.session.advanceToFinale();
    expect(summary.finished).toBe(true);
    // ONLY now, post-finale, does the retrospective unseal — through its OWN code path, not the lever.
    const retro = sb.session.seasonRetrospective();
    expect(retro).not.toBeNull();
    // And it carries the genuinely-hidden story (the sentinel proves the unseal is real) — but that
    // is the retrospective's sanctioned post-season reveal, NOT something the fast-forward returned.
    expect(JSON.stringify(retro)).toContain(`${SENTINEL}-scene-gate`);
  });
});

describe("L38 — the loop is bounded (can never spin forever)", () => {
  it("finishes well within the guard — a real season is far under the cap", () => {
    const { sb } = liveGame("ff-bounded", 17);
    const started = Date.now();
    const summary = sb.session.advanceToFinale();
    // The whole drive completes promptly (no infinite spin); a generous wall-clock ceiling.
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(summary.finished).toBe(true);
  });
});

describe("L38 — the admin seam is admin-channel-only and Vault-free by construction", () => {
  it("advanceToFinale is on the ADMIN allowlist and NOT on the player channel", () => {
    expect(ADMIN_TOOLS.some((t) => t.name === "advanceToFinale")).toBe(true);
    expect(PLAYER_TOOLS.some((t) => t.name === "advanceToFinale")).toBe(false);
    // Every admin tool stays readsVault:false — the type forbids a Vault reader (0001).
    for (const t of ADMIN_TOOLS) expect(t.readsVault).toBe(false);
  });

  it("the player channel refuses advanceToFinale; the admin channel finishes the season", async () => {
    const { sb } = liveGame("ff-channel", 23);
    plantHidden(sb, "channel");
    await expect(sb.mcp.player.callTool("advanceToFinale", {})).rejects.toThrow(/not available/);
    const result = await sb.mcp.admin.callTool("advanceToFinale", {});
    expect((result as { finished: boolean }).finished).toBe(true);
    expect((result as { winnerName: string | null }).winnerName).toBeTruthy();
    // The admin channel's result is Vault-free.
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it("the AdminPort delegate is Vault-free and returns a not-started summary unwired", () => {
    // A bare AdminPort (no session wired) returns the safe not-started summary — never throws,
    // never reads anything. Proves the seam is a void-safe closure (like the reset/health delegates).
    const bare = new AdminPort(new InMemoryGameStateRepository({ week: 1, phase: "setup", houseguests: [] }));
    const summary = bare.advanceToFinale();
    expect(summary.started).toBe(false);
    expect(summary.finished).toBe(false);
    expect(summary.winnerName).toBeNull();
  });
});

describe("L38 — cross-user isolation: finishing user A never touches user B's live season", () => {
  it("the lever is scoped to one sandbox", () => {
    const reg = new GameSessionRegistry();
    const a = reg.sandboxFor("ff-iso-a");
    const b = reg.sandboxFor("ff-iso-b");
    a.session.createCharacter({ playerName: "The Player", seed: 31 });
    b.session.createCharacter({ playerName: "The Player", seed: 32 });
    const summary = a.session.advanceToFinale();
    expect(summary.finished).toBe(true);
    // B is untouched — still live, retrospective still sealed.
    expect(b.session.getGameState().finished).toBe(false);
    expect(b.session.seasonRetrospective()).toBeNull();
  });
});
