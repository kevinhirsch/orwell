import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { McpServer } from "../../src/adapters/mcp/McpServer";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameHouse } from "../../src/engine/characterFactory";

/**
 * Feature 0041 (the linchpin) — proof that character evolution is WIRED into the live game, not just
 * a module/test. A real per-user sandbox is driven through the MCP player channel to a winner; we
 * then prove on the engine side that:
 *   - souls evolved from live history (both confidence AND distress), while the static CHARACTER is byte-stable
 *   - the SoulStore now lives in the sandbox and `recall` surfaces a specific past inflection live
 *   - the whole arc persists across a restart (0030) and recall still works
 *   - no emotional number / hidden soul field ever crosses to a player surface (Vault Wall, 0001)
 * HARD rule: roles only — no names.
 */

/** Drive a live game to completion through the permissioned player channel (resolving every decision). */
async function playToEnd(player: McpServer): Promise<void> {
  for (let i = 0; i < 6000; i++) {
    const adv = (await player.callTool("advanceGame", {})) as AdvanceView;
    if (adv.finished) return;
    const p = adv.pending;
    if (!p) continue;
    if (p.kind === "nominations") await player.callTool("submitDecision", { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
    else if (p.kind === "veto-decision") await player.callTool("submitDecision", { kind: "veto-decision", use: false });
    else if (p.kind === "replacement") await player.callTool("submitDecision", { kind: "replacement", replacement: p.options[0]!.id });
    else if (p.kind === "finale-statement") await player.callTool("submitDecision", { kind: "finale-statement", statement: "I ran this house." });
    else if (p.kind === "finale-answer") await player.callTool("submitDecision", { kind: "finale-answer", appeal: p.appeals![0]! });
    else if (p.kind === "juror-vote") await player.callTool("submitDecision", { kind: "juror-vote", vote: p.options[0]!.id });
    else await player.callTool("submitDecision", { kind: "eviction-vote", vote: p.options[0]!.id });
  }
  throw new Error("game did not finish within bound");
}

const houseOf = (reg: GameSessionRegistry, user: string): GameHouse =>
  reg.sandboxFor(user).session.snapshot().house!;
const everySoul = (h: GameHouse) => [h.player, ...h.npcs].map((hg) => ({ id: hg.id, soul: hg.soul }));

describe("0041 — character evolution is live (over the MCP boundary)", () => {
  it("evolves souls from live history while keeping the static character byte-stable, and recalls the arc", async () => {
    const reg = new GameSessionRegistry();
    const user = "evo-1";
    const player = reg.resolver()("player", user);
    await player.callTool("createCharacter", { playerName: "The Player", seed: 2 });

    // Capture the STATIC character baseline at the start (byte-for-byte).
    const charsAtStart = new Map(everySoulCharacters(houseOf(reg, user)));

    await playToEnd(player);

    const house = houseOf(reg, user);
    const souls = everySoul(house);

    // Driven by live history: the season moved souls in BOTH directions (confidence + distress),
    // and accumulated an arc (emotionalHistory) — none of this existed at the calm 0.5 start.
    expect(souls.some((s) => s.soul.emotionalState > 0.5)).toBe(true); // emboldened (comp wins/survivals)
    expect(souls.some((s) => s.soul.emotionalState < 0.5)).toBe(true); // rattled (a blindside)
    expect(souls.some((s) => s.soul.emotionalHistory.length > 0)).toBe(true);
    expect(souls.every((s) => s.soul.emotionalState >= 0 && s.soul.emotionalState <= 1)).toBe(true);

    // CHARACTER byte-stable (0007): the static baseline never drifted, only the soul did.
    for (const [id, json] of charsAtStart) {
      expect(JSON.stringify(houseCharacter(house, id))).toBe(json);
    }

    // The SoulStore now lives in the sandbox (the linchpin): recall surfaces a SPECIFIC past
    // inflection live. Find a houseguest who won a competition and recall that exact moment.
    const engine = reg.sandboxFor(user).engine;
    const winner = souls.find((s) => s.soul.memory.some((m) => m.includes("won a competition")));
    expect(winner, "at least one houseguest won a competition and recorded it to their soul").toBeTruthy();
    const hits = engine.soul.recall(winner!.id, "won a competition", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((m) => m.content.includes("won a competition"))).toBe(true);
  });

  it("persists the evolved arc across a restart, and recall still works (0030)", async () => {
    const reg = new GameSessionRegistry();
    const user = "evo-2";
    const player = reg.resolver()("player", user);
    await player.callTool("createCharacter", { playerName: "The Player", seed: 5 });

    // Advance well into the season (past several evictions) without forcing it to the very end.
    for (let i = 0; i < 120; i++) {
      const adv = (await player.callTool("advanceGame", {})) as AdvanceView;
      if (adv.finished) break;
      const p = adv.pending;
      if (!p) continue;
      if (p.kind === "nominations") await player.callTool("submitDecision", { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
      else if (p.kind === "veto-decision") await player.callTool("submitDecision", { kind: "veto-decision", use: false });
      else if (p.kind === "replacement") await player.callTool("submitDecision", { kind: "replacement", replacement: p.options[0]!.id });
      else if (p.kind === "finale-statement") await player.callTool("submitDecision", { kind: "finale-statement", statement: "x" });
      else if (p.kind === "finale-answer") await player.callTool("submitDecision", { kind: "finale-answer", appeal: p.appeals![0]! });
      else if (p.kind === "juror-vote") await player.callTool("submitDecision", { kind: "juror-vote", vote: p.options[0]!.id });
      else await player.callTool("submitDecision", { kind: "eviction-vote", vote: p.options[0]!.id });
    }

    const before = everySoul(houseOf(reg, user)).map((s) => ({
      id: s.id, state: s.soul.emotionalState, history: s.soul.emotionalHistory.length, memory: s.soul.memory.length,
    }));
    // A houseguest with a real arc, to prove recall survives the restart.
    const arced = everySoul(houseOf(reg, user)).find((s) => s.soul.memory.length > 0)!;
    expect(arced).toBeTruthy();

    // Restart: a fresh registry restored from the durable snapshot.
    const snap = reg.snapshot(user);
    const reg2 = new GameSessionRegistry();
    reg2.restore(user, snap);

    const after = everySoul(houseOf(reg2, user)).map((s) => ({
      id: s.id, state: s.soul.emotionalState, history: s.soul.emotionalHistory.length, memory: s.soul.memory.length,
    }));
    expect(after).toEqual(before); // the evolved arc came back losslessly (no thinning)

    // Recall is re-derived from the persisted arc — it still surfaces that houseguest's memories.
    const hits = reg2.sandboxFor(user).engine.soul.recall(arced.id, arced.soul.memory[0]!, 3);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("never leaks an emotional number or hidden soul field onto a player surface (Vault Wall)", async () => {
    const reg = new GameSessionRegistry();
    const user = "evo-3";
    const player = reg.resolver()("player", user);
    await player.callTool("createCharacter", { playerName: "The Player", seed: 7 });

    // Advance enough that souls have visibly evolved off the 0.5 baseline.
    for (let i = 0; i < 60; i++) {
      const adv = (await player.callTool("advanceGame", {})) as AdvanceView;
      if (adv.finished) break;
      const p = adv.pending;
      if (!p) continue;
      if (p.kind === "nominations") await player.callTool("submitDecision", { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
      else if (p.kind === "veto-decision") await player.callTool("submitDecision", { kind: "veto-decision", use: false });
      else if (p.kind === "replacement") await player.callTool("submitDecision", { kind: "replacement", replacement: p.options[0]!.id });
      else await player.callTool("submitDecision", { kind: "eviction-vote", vote: p.options[0]!.id });
    }

    // The hidden soul numbers that exist engine-side right now.
    const souls = everySoul(houseOf(reg, user));
    const evolvedStates = souls
      .filter((s) => s.soul.emotionalState !== 0.5)
      .map((s) => String(s.soul.emotionalState));
    expect(evolvedStates.length).toBeGreaterThan(0); // there IS hidden state to leak

    // Sweep every player-facing projection.
    const sb = reg.sandboxFor(user);
    const surface = [
      JSON.stringify(await player.callTool("gameStatus", {})),
      JSON.stringify(await player.callTool("getGameState", {})),
      JSON.stringify(await player.callTool("getMomentPrompt", {})),
      sb.player.produce("player-visible log"),
      sb.player.produce("scene narration"),
      JSON.stringify(sb.player.getVisibleState()),
      JSON.stringify(sb.player.assembleNarrationContext("scene")),
    ].join("\n---\n");

    // No raw emotional value, and no hidden soul field name, ever appears on a player surface.
    for (const v of evolvedStates) expect(surface.includes(v)).toBe(false);
    for (const field of ["emotionalState", "emotionalHistory", "emotionalBaseline", "volatility"]) {
      expect(surface.includes(field)).toBe(false);
    }
  });
});

// --- helpers reading the engine-side house (souls are engine-only; tests read them to prove the wall) -
function everySoulCharacters(h: GameHouse): Array<[string, string]> {
  return [h.player, ...h.npcs].map((hg) => [hg.id, JSON.stringify(hg.character)] as [string, string]);
}
function houseCharacter(h: GameHouse, id: string): unknown {
  return [h.player, ...h.npcs].find((hg) => hg.id === id)?.character;
}
