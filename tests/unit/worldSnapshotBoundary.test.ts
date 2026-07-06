import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { buildSandbox } from "../support/sandbox";

// Feature 0062 — the move-in zeitgeist write-back. The engine has a COMPLETE adapter impl
// (GameSessionAdapter.recordWorldSnapshot) but the player MCP channel never exposed it — the same
// boundary bug just fixed for recordCastProfile/preSeedCast. This proves the seam is open: the FE
// can reach the write-back over the MCP boundary. Roles only (no names from any corpus).

describe("0062 — the world-snapshot write-back reaches the engine over the MCP boundary", () => {
  function playerServer(): { server: McpServer; session: GameSessionAdapter } {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    return { server, session };
  }

  it("recordWorldSnapshot is on the player channel (the boundary bug)", () => {
    const names = PLAYER_TOOLS.map((t) => t.name);
    expect(names).toContain("recordWorldSnapshot");
  });

  it("dispatches recordWorldSnapshot — it is not rejected as 'not available'", async () => {
    const { server, session } = playerServer();
    // A started game so there is a snapshot to freeze onto (the §8 no-op otherwise is still a valid dispatch).
    session.createCharacter({ playerName: "The Player", seed: 5 });
    const res = (await server.callTool("recordWorldSnapshot", {
      slices: { mood: "a buzzing, online summer", screen: ["a streaming hit"] },
    })) as { accepted: boolean; source: string };
    expect(res.accepted).toBe(true);
    expect(res.source).toBe("web_search");
  });

  it("dispatches with no slices (the slices field is optional)", async () => {
    const { server, session } = playerServer();
    session.createCharacter({ playerName: "The Player", seed: 6 });
    const res = (await server.callTool("recordWorldSnapshot", {})) as { accepted: boolean };
    expect(res.accepted).toBe(true);
  });

  it("a no-op before a game starts (nothing to freeze onto) still dispatches cleanly", async () => {
    const { server } = playerServer();
    const res = (await server.callTool("recordWorldSnapshot", { slices: { mood: "x" } })) as {
      accepted: boolean; source: string;
    };
    expect(res.accepted).toBe(false);
    expect(res.source).toBe("absent");
  });

  it("refuses a malformed slices (an array where an object is expected) with a typed field name", async () => {
    const { server, session } = playerServer();
    session.createCharacter({ playerName: "The Player", seed: 7 });
    await expect(
      server.callTool("recordWorldSnapshot", { slices: ["not", "an", "object"] }),
    ).rejects.toThrow(/slices/);
  });
});

// BE-103/TCG-16 — worldSnapshotView (the READ counterpart) was fully implemented in the port + adapter
// but had NO registry entry and NO McpServer dispatch case at all — a dead endpoint nothing could ever
// call, found only by manual review. Same boundary-test template as recordWorldSnapshot above.
describe("BE-103 — the world-snapshot READ (worldSnapshotView) reaches the engine over the MCP boundary", () => {
  function playerServer(): { server: McpServer; session: GameSessionAdapter } {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    return { server, session };
  }

  it("worldSnapshotView is on the player channel (the boundary bug)", () => {
    const names = PLAYER_TOOLS.map((t) => t.name);
    expect(names).toContain("worldSnapshotView");
  });

  it("dispatches worldSnapshotView — it is not rejected as 'not available' or 'unhandled tool'", async () => {
    const { server, session } = playerServer();
    session.createCharacter({ playerName: "The Player", seed: 5 });
    await server.callTool("recordWorldSnapshot", { slices: { mood: "a buzzing, online summer" } });
    const view = (await server.callTool("worldSnapshotView", {})) as { slices: Record<string, unknown> } | null;
    expect(view).not.toBeNull();
    expect(view!.slices.mood).toBe("a buzzing, online summer");
  });

  it("null before a game starts or when nothing was ever captured (still a clean dispatch, not a throw)", async () => {
    const { server } = playerServer();
    const view = await server.callTool("worldSnapshotView", {});
    expect(view).toBeNull();
  });
});
