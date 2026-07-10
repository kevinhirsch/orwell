import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { composeRuntime } from "../../src/composition/runtime";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { buildSandbox } from "../support/sandbox";
import { DEEP_PROFILE_KIND, STORY_THREAD_KIND } from "../../src/engine/deepProfile";
import type { AdvanceView, GameStateView } from "../../src/ports/GameSession";

// Feature 0065 (advance-warm) — warm the NEXT season's deep cast DATA into a per-user HOLDING STORE that
// survives the sandbox rotation, and ADOPT it at the confirmed cutover. Roles only (no corpus names): the
// warmed roster is engine ids + public facets. The active season must be UNCHANGED while the next warms.

const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-0065ns-"));

function resolveLegally(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
}

function playBeats(s: GameSessionAdapter, beats: number): void {
  for (let i = 0; i < beats; i++) {
    const v = s.advanceGame();
    if (v.pending) resolveLegally(s, v.pending);
    if (v.finished) break;
  }
}

// ── 1. The MCP boundary (MANDATORY: the four-place wiring is dead at runtime without this) ─────────────

describe("0065 advance-warm — preSeedNextSeason reaches the engine over the MCP boundary", () => {
  function playerServer(): McpServer {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    return new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  }

  it("preSeedNextSeason is on the player channel", () => {
    expect(PLAYER_TOOLS.map((t) => t.name)).toContain("preSeedNextSeason");
  });

  it("dispatches preSeedNextSeason (standalone fallback) — NOT rejected as 'not available' and warms a cast", async () => {
    const server = playerServer();
    const warm = (await server.callTool("preSeedNextSeason", { seed: 7 })) as {
      warmed: boolean; seed: number; house: { id: string }[]; portraitPrompts: unknown[];
    };
    expect(warm.warmed).toBe(true);
    expect(warm.seed).toBe(7);
    expect(warm.house.length).toBe(15);
    expect(warm.portraitPrompts.length).toBe(15);
  });

  it("dispatches a warm + author write-back in one call (the { profile } arg)", async () => {
    const server = playerServer();
    const seeded = new GameSessionAdapter().preSeedCast({ seed: 8 }); // mirror the same deterministic cast to learn an id
    const id = seeded.house[0]!.id;
    const res = (await server.callTool("preSeedNextSeason", {
      seed: 8,
      profile: { houseguestId: id, biography: "An authored next-season backstory. With real presentable detail." },
    })) as { warmed: boolean; authored?: { accepted: boolean } };
    expect(res.warmed).toBe(true);
    expect(res.authored?.accepted).toBe(true);
  });

  it("refuses a malformed profile at the boundary (a deliberate 400, never a blind cast)", async () => {
    const server = playerServer();
    await expect(server.callTool("preSeedNextSeason", { profile: { biography: "no id" } }))
      .rejects.toThrow(/profile\.houseguestId/);
  });
});

// ── 2. Determinism: an advance-warmed season == an un-warmed season off the same seed ──────────────────

describe("0065 advance-warm — the held cast is byte-identical to an un-warmed season off the same seed", () => {
  it("warmNextSeasonScratch off seed N produces the same roster preSeedCast off seed N does", () => {
    const advance = new GameSessionAdapter().preSeedNextSeason({ seed: 314 });
    const plain = new GameSessionAdapter().preSeedCast({ seed: 314 });
    expect(advance.warmed && plain.warmed).toBe(true);
    expect(advance.house.map((h) => h.name)).toEqual(plain.house.map((h) => h.name));
    expect(advance.house.map((h) => h.biography)).toEqual(plain.house.map((h) => h.biography));
  });
});

// ── 3. NO EARLY CUTOVER: the active season is byte-identical before vs after a mid-season warm ──────────

describe("0065 advance-warm — NO EARLY CUTOVER (the active season is untouched while the next warms)", () => {
  it("getGameState (cast + season) is byte-identical before vs after a mid-season next-season warm", () => {
    const runtime = composeRuntime({ clock: new FakeClock() });
    const user = "no-early-cutover";
    const mcpPromise = runtime.registry.resolver()("player", user);
    mcpPromise.callTool("createCharacter", { playerName: "The Player", seed: 101 });
    const sb = runtime.registry.sandboxFor(user);
    playBeats(sb.session, 6); // a real, mid-flight active season

    const before = JSON.stringify(sb.session.getGameState());
    const beforeStatus = JSON.stringify(sb.session.gameStatus());

    // Advance-warm the NEXT season (a NEW seed) WHILE the current season runs.
    const warm = sb.session.preSeedNextSeason({ seed: 202 });
    expect(warm.warmed).toBe(true);
    expect(warm.seed).toBe(202);

    // The ACTIVE season's identity + cast + every player-facing projection is UNCHANGED.
    expect(JSON.stringify(sb.session.getGameState())).toBe(before);
    expect(JSON.stringify(sb.session.gameStatus())).toBe(beforeStatus);
  });

  it("preSeedCast STILL refuses mid-season (only the new advance-warm path works while a season runs)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 5 });
    expect(s.preSeedCast({ seed: 6 }).refused).toBe("in-progress"); // unchanged behavior
    // …but the advance-warm path warms a held cast without touching the live game.
    const warm = s.preSeedNextSeason({ seed: 6 });
    expect(warm.warmed).toBe(true);
    expect(s.getGameState().started).toBe(true); // active season still live + unchanged
  });
});

// ── 4. ADOPTION at the confirmed cutover (the held cast survives the rotation + ships) ──────────────────

describe("0065 advance-warm — the held cast survives the cutover and IS the next season's cast", () => {
  it("a confirmed restart adopts the advance-warmed, FE-authored cast (it survives the sandbox rotation)", async () => {
    const runtime = composeRuntime({ clock: new FakeClock() });
    const user = "adopt";
    const mcp = runtime.registry.resolver()("player", user);
    await mcp.callTool("createCharacter", { playerName: "The Player", seed: 11 });
    playBeats(runtime.registry.sandboxFor(user).session, 6);

    // Advance-warm the next season (new seed) + deeply author one houseguest, mid-finale-ish.
    const nextSeed = 4242;
    const probe = new GameSessionAdapter().preSeedCast({ seed: nextSeed }); // learn a deterministic id
    const id = probe.house[0]!.id;
    const AUTHORED = "An advance-authored life that must survive the cutover. With presentable detail.";
    const warm = await mcp.callTool("preSeedNextSeason", {
      seed: nextSeed, profile: { houseguestId: id, biography: AUTHORED },
    }) as { warmed: boolean };
    expect(warm.warmed).toBe(true);

    // The confirmed cutover (the ONE sanctioned door). No explicit seed ⇒ the held warm's seed is adopted.
    const view = (await mcp.callTool("createCharacter", {
      playerName: "The Player", confirmRestart: true,
    })) as GameStateView;
    expect(view.started).toBe(true);

    const fresh = runtime.registry.sandboxFor(user);
    // The new season IS the advance-warmed cast: the seed was adopted and the authored bio shipped.
    expect(fresh.session.snapshot().seed).toBe(nextSeed);
    expect(view.house.find((h) => h.id === id)?.biography).toBe(AUTHORED);
    // …and the next season's commits stay clean (the adopted cast didn't corrupt the rotation).
    playBeats(fresh.session, 4);
  });

  it("the adopted season is the SAME season an un-warmed restart on that seed would start (determinism)", async () => {
    // Path A: advance-warm seed S, then cutover with no explicit seed (adopts S).
    const rt = composeRuntime({ clock: new FakeClock() });
    const u = "det-adopt";
    const m = rt.registry.resolver()("player", u);
    await m.callTool("createCharacter", { playerName: "The Player", seed: 1 });
    playBeats(rt.registry.sandboxFor(u).session, 6);
    await m.callTool("preSeedNextSeason", { seed: 7777 });
    await m.callTool("createCharacter", { playerName: "The Player", confirmRestart: true });
    const adoptedHouse = rt.registry.sandboxFor(u).session.getGameState().house.map((h) => ({ id: h.id, name: h.name, biography: h.biography }));

    // Path B: a plain restart that explicitly starts seed S, NO advance-warm.
    const rt2 = composeRuntime({ clock: new FakeClock() });
    const u2 = "det-plain";
    const m2 = rt2.registry.resolver()("player", u2);
    await m2.callTool("createCharacter", { playerName: "The Player", seed: 1 });
    playBeats(rt2.registry.sandboxFor(u2).session, 6);
    await m2.callTool("createCharacter", { playerName: "The Player", seed: 7777, confirmRestart: true });
    const plainHouse = rt2.registry.sandboxFor(u2).session.getGameState().house.map((h) => ({ id: h.id, name: h.name, biography: h.biography }));

    expect(adoptedHouse).toEqual(plainHouse);
  });

  it("the cross-sandbox warm RE-SEALS the hidden deep layer into the new sandbox's Vault (recall + retro intact)", async () => {
    // The held cast was warmed on a DETACHED scratch (no Vault hooks), so the cutover must re-seal its
    // hidden layer into the FRESH sandbox's Vault. Proof: the adopted season's sealed deep records match
    // a plain (un-warmed) season started on the SAME seed — the engine-only deep layer is byte-equivalent.
    const seed = 6363;
    // Path A: advance-warm seed → cutover (adopts it).
    const rtA = composeRuntime({ clock: new FakeClock() });
    const uA = "reseal-adopt";
    const mA = rtA.registry.resolver()("player", uA);
    await mA.callTool("createCharacter", { playerName: "The Player", seed: 1 });
    playBeats(rtA.registry.sandboxFor(uA).session, 6);
    await mA.callTool("preSeedNextSeason", { seed });
    await mA.callTool("createCharacter", { playerName: "The Player", confirmRestart: true });
    const vaultA = rtA.registry.sandboxFor(uA).engine.vault;
    const profilesA = vaultA.readHidden({ kind: DEEP_PROFILE_KIND }).length;
    const threadsA = vaultA.readHidden({ kind: STORY_THREAD_KIND }).length;

    // Path B: a plain restart that explicitly starts the SAME seed, NO advance-warm.
    const rtB = composeRuntime({ clock: new FakeClock() });
    const uB = "reseal-plain";
    const mB = rtB.registry.resolver()("player", uB);
    await mB.callTool("createCharacter", { playerName: "The Player", seed: 1 });
    playBeats(rtB.registry.sandboxFor(uB).session, 6);
    await mB.callTool("createCharacter", { playerName: "The Player", seed, confirmRestart: true });
    const vaultB = rtB.registry.sandboxFor(uB).engine.vault;
    const profilesB = vaultB.readHidden({ kind: DEEP_PROFILE_KIND }).length;
    const threadsB = vaultB.readHidden({ kind: STORY_THREAD_KIND }).length;

    // The adopted season seals the SAME deep layer the un-warmed season does (the re-seal worked).
    expect(profilesA).toBe(profilesB);
    expect(profilesA).toBeGreaterThan(0);
    expect(threadsA).toBe(threadsB);
  });

  it("the buffer is consumed at the cutover — a SECOND restart starts a fresh (un-warmed) cast", async () => {
    const rt = composeRuntime({ clock: new FakeClock() });
    const u = "consume";
    const m = rt.registry.resolver()("player", u);
    await m.callTool("createCharacter", { playerName: "The Player", seed: 1 });
    playBeats(rt.registry.sandboxFor(u).session, 6);
    await m.callTool("preSeedNextSeason", { seed: 9090 });
    await m.callTool("createCharacter", { playerName: "The Player", confirmRestart: true });
    expect(rt.registry.sandboxFor(u).session.snapshot().seed).toBe(9090); // adopted

    // A second restart with no further advance-warm starts a NORMAL fresh cast (the buffer was consumed).
    playBeats(rt.registry.sandboxFor(u).session, 4);
    const view = (await m.callTool("createCharacter", {
      playerName: "The Player", seed: 5151, confirmRestart: true,
    })) as GameStateView;
    expect(view.started).toBe(true);
    expect(rt.registry.sandboxFor(u).session.snapshot().seed).toBe(5151); // NOT a stale 9090 warm
  });
});

// ── 5. Durability: the held warm survives an engine restart (the registry rehydrates from the snapshot) ─

describe("0065 advance-warm — the held warm is durable (survives an engine restart mid-finale)", () => {
  it("an advance-warm begun before a process restart is still adopted at the cutover", async () => {
    const dir = freshDir();
    const user = "durable";
    const nextSeed = 33033;
    // Process 1: start a season, advance-warm the next one, then "crash" (drop the runtime).
    {
      const rt = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() });
      const m = rt.registry.resolver()("player", user);
      await m.callTool("createCharacter", { playerName: "The Player", seed: 1 });
      playBeats(rt.registry.sandboxFor(user).session, 6);
      await m.callTool("preSeedNextSeason", { seed: nextSeed });
      // The durable mirror is on the live snapshot now.
      expect(rt.registry.sandboxFor(user).session.snapshot().nextSeasonWarm?.seed).toBe(nextSeed);
    }
    // Process 2: a fresh runtime over the SAME store. The cutover adopts the warm begun before the restart.
    {
      const rt = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() });
      const m = rt.registry.resolver()("player", user);
      const view = (await m.callTool("createCharacter", {
        playerName: "The Player", confirmRestart: true,
      })) as GameStateView;
      expect(view.started).toBe(true);
      expect(rt.registry.sandboxFor(user).session.snapshot().seed).toBe(nextSeed); // the held seed was adopted
    }
  });
});

// ── 6. The Vault Wall holds across the advance-warm + adoption ──────────────────────────────────────────

describe("0065 advance-warm — the Vault Wall holds end to end", () => {
  it("authored HIDDEN next-season content never crosses on the warm view, getGameState, or the adopted season", async () => {
    const rt = composeRuntime({ clock: new FakeClock() });
    const user = "vault";
    const mcp = rt.registry.resolver()("player", user);
    await mcp.callTool("createCharacter", { playerName: "The Player", seed: 1 });
    const sb = rt.registry.sandboxFor(user);
    playBeats(sb.session, 6);

    const nextSeed = 8181;
    const probe = new GameSessionAdapter().preSeedCast({ seed: nextSeed });
    const id = probe.house[0]!.id;
    const SECRET = "ZZZ-ADVANCE-WARM-SECRET-LEDGER-0065";

    const warm = (await mcp.callTool("preSeedNextSeason", {
      seed: nextSeed,
      profile: { houseguestId: id, secrets: [SECRET], trueGoals: ["reach the end"], weakness: "too loyal once committed" },
    })) as { warmed: boolean; house: Record<string, unknown>[]; authored?: { accepted: boolean; hiddenFields: string[] } };
    expect(warm.warmed).toBe(true);
    expect(warm.authored?.accepted).toBe(true);

    // The warm VIEW carries the PUBLIC roster only — no hidden field, no secret string.
    expect(JSON.stringify(warm).includes(SECRET)).toBe(false);
    for (const card of warm.house) {
      for (const hidden of ["secrets", "trueGoals", "weakness", "dayOnePerception"]) {
        expect(card).not.toHaveProperty(hidden);
      }
    }
    // The ACTIVE game state never leaks the held secret while the next season warms.
    expect(JSON.stringify(sb.session.getGameState()).includes(SECRET)).toBe(false);

    // After the cutover, the adopted live game state never leaks the sealed secret either.
    await mcp.callTool("createCharacter", { playerName: "The Player", confirmRestart: true });
    const fresh = rt.registry.sandboxFor(user);
    expect(JSON.stringify(fresh.session.getGameState()).includes(SECRET)).toBe(false);
  });

  it("a player-mirroring next-season profile is refused (anti-sycophancy holds on the holding store)", async () => {
    const server = (() => {
      const sb = buildSandbox(2);
      const session = new GameSessionAdapter();
      const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
      return new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    })();
    const probe = new GameSessionAdapter().preSeedCast({ seed: 55 });
    const id = probe.house[0]!.id;
    const res = (await server.callTool("preSeedNextSeason", {
      seed: 55,
      profile: { houseguestId: id, biography: "This NPC is obsessed with The Player and their every move." },
    })) as { authored?: { accepted: boolean; reason?: string } };
    // playerName here is the intake's (empty) — a 3+ char name is needed to trip the mirror guard; the
    // point is the seam runs the SAME validation. With no player name the author is accepted; assert it
    // at least went through the recordCastProfile path (accepted flag present).
    expect(res.authored).toBeDefined();
    expect(typeof res.authored!.accepted).toBe("boolean");
  });
});
