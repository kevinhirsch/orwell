import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { buildSandbox } from "../support/sandbox";

// Feature 0116 — the model-authored cast-genesis write-back. The four-place-rule boundary test (the
// castPrewarm / worldSnapshotBoundary template): a write-back with the MCP wiring missing typechecks and
// passes the static gates but is DEAD at runtime. This proves the seam is open end-to-end AND that the
// committed skeleton actually folds. Roles only — NPCs are engine ids; the proposal's synthetic display
// names are obviously-fake military-phonetic fixtures, never a corpus/legacy cast.

const NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India",
  "Juliet", "Kilo", "Lima", "Mike", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform",
  "Victor", "Whiskey", "Yankee", "Zulu", "Nova", "Onyx", "Perry", "Reed", "Sable", "Vesper"];
const synthName = (i: number): string => `${NATO[i % NATO.length]} ${NATO[(i + 11) % NATO.length]}`;

function playerServer(): { server: McpServer; session: GameSessionAdapter } {
  const sb = buildSandbox(1);
  const session = new GameSessionAdapter();
  const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
  const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  return { server, session };
}

/** Build a full, envelope-CLEAN 15-NPC proposal off the warmed roster ids. */
function fullProposal(ids: string[]): { npcs: unknown[]; ties: unknown[] } {
  return {
    npcs: ids.map((id, i) => ({
      id,
      name: synthName(i),
      identity: `a distinct model-authored houseguest, slot ${i}`,
      stats: { physical: 0.3 + ((i * 7) % 55) / 100, mental: 0.9 - ((i * 5) % 60) / 100, social: 0.35 + ((i * 11) % 50) / 100 },
      hiddenElements: [
        { kind: "divergent-persona", detail: `wears a mask, slot ${i}` },
        { kind: "pre-game-tie", detail: `a quiet pre-show pact, slot ${i}` },
        { kind: "secret-motive", detail: `a private reason to win, slot ${i}` },
      ],
    })),
    ties: [{ a: ids[0], b: ids[1], nature: "casting-callback" }],
  };
}

describe("0116 — recordCastGenesis reaches the engine over the MCP boundary", () => {
  it("recordCastGenesis is on the player channel (the boundary bug)", () => {
    expect(PLAYER_TOOLS.map((t) => t.name)).toContain("recordCastGenesis");
  });

  it("dispatches preSeedCast then recordCastGenesis — neither is rejected as 'not available'", async () => {
    const { server } = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 5 })) as { warmed: boolean; house: { id: string }[] };
    expect(warm.warmed).toBe(true);
    const ids = warm.house.map((h) => h.id);
    const res = (await server.callTool("recordCastGenesis", fullProposal(ids))) as {
      accepted: boolean; committed: number; varianceOk: boolean; violations: unknown[];
    };
    expect(res.accepted).toBe(true);
    expect(res.committed).toBe(15);
    expect(res.varianceOk).toBe(true);
    // A clean proposal produces no re-roll violations.
    expect((res.violations as { action: string }[]).some((v) => v.action === "re-roll")).toBe(false);
  });

  it("the committed skeleton actually folds — the started game's roster carries the authored identity", async () => {
    const { server, session } = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 9 })) as { house: { id: string }[] };
    const ids = warm.house.map((h) => h.id);
    await server.callTool("recordCastGenesis", fullProposal(ids));
    // Finalize casting (adopts the warmed, genesis-authored cast).
    session.createCharacter({ playerName: "The Player" });
    const state = session.getGameState();
    const names = state.house.map((h) => h.name);
    // The model-authored names + freeform identity concepts crossed onto the live roster.
    expect(names).toContain(synthName(0));
    expect(state.house.every((h) => typeof (h as { identityConcept?: string }).identityConcept === "string")).toBe(true);
  });

  it("refuses a malformed npcs (non-array) with a typed field name (E31)", async () => {
    const { server } = playerServer();
    await server.callTool("preSeedCast", { seed: 3 });
    await expect(server.callTool("recordCastGenesis", { npcs: "not-an-array" })).rejects.toThrow(/npcs/);
  });

  it("refuses cleanly with no warmed cast (a no-op dispatch, never a throw)", async () => {
    const { server } = playerServer();
    const res = (await server.callTool("recordCastGenesis", { npcs: [] })) as { accepted: boolean; reason?: string };
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/warmed/);
  });

  it("is refused once a season is running (genesis is a pre-game operation)", async () => {
    const { server, session } = playerServer();
    session.createCharacter({ playerName: "The Player", seed: 8 });
    const res = (await server.callTool("recordCastGenesis", { npcs: [] })) as { accepted: boolean; reason?: string };
    expect(res.accepted).toBe(false);
  });

  it("Vault Wall: committed hidden elements + ties never reach the player projection", async () => {
    const { server, session } = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 21 })) as { house: { id: string }[] };
    const ids = warm.house.map((h) => h.id);
    const SENTINEL = "VAULT_SENTINEL_GENESIS_XYZZY";
    const proposal = fullProposal(ids);
    // Poison a hidden element + rely on the tie backstory — neither may cross the wall.
    (proposal.npcs[0] as { hiddenElements: { detail: string }[] }).hiddenElements[0]!.detail = `secret ${SENTINEL}`;
    (proposal.ties[0] as { backstory?: string }).backstory = `they met at ${SENTINEL}`;
    await server.callTool("recordCastGenesis", proposal);
    session.createCharacter({ playerName: "The Player" });
    // Sweep every player-facing projection the adapter exposes — the roster, the status board, and each
    // NPC's knowledge-bounded voicing (npcVoice). The hidden-element detail + the tie backstory (exposure
    // is "sealed", no pathway fired) must appear on NONE of them.
    let sweep = JSON.stringify(session.getGameState()) + JSON.stringify(session.gameStatus());
    for (const h of session.getGameState().house) sweep += JSON.stringify(session.npcVoice(h.id) ?? {});
    expect(sweep).not.toContain(SENTINEL);
  });
});
