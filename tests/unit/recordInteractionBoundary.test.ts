import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { buildSandbox } from "../support/sandbox";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * #1734 (B4) — normalize + validate `withIds` at the scene-extraction / record boundary.
 *
 * The `recordInteraction` requireShape must reject malformed EntityIds in initiator, witnessSet,
 * and toward BEFORE they reach the engine. Canonical form: "player" or "npc:<n>" (matching
 * `src/domain/ids.ts` `npc()`). Roles only — no houseguest names from any corpus.
 */

describe("#1734 — recordInteraction requireShape rejects malformed EntityIds at the boundary", () => {
  function playerServer(): { server: McpServer } {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    const server = new McpServer("player", {
      player: sb.player,
      admin: sb.admin,
      summary: sb.summary,
      commands,
      session,
    });
    return { server };
  }

  const validArgs = {
    initiator: PLAYER,
    witnessSet: [npc(1), npc(2)],
    content: "They talked strategy in the backyard.",
  };

  it("recordInteraction is on the player channel", () => {
    expect(PLAYER_TOOLS.map((t) => t.name)).toContain("recordInteraction");
  });

  it("rejects malformed witnessSet entries (non-canonical format)", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, witnessSet: ["npc:abc", "player"] }),
    ).rejects.toThrow(/witnessSet/);
  });

  it("rejects entirely invalid witnessSet ids", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, witnessSet: ["bad-id"] }),
    ).rejects.toThrow(/witnessSet/);
  });

  it("rejects witnessSet with malformed prefix format", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, witnessSet: ["np:2"] }),
    ).rejects.toThrow(/witnessSet/);
  });

  it("rejects malformed initiator (empty string)", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, initiator: "" }),
    ).rejects.toThrow(/initiator/);
  });

  it("rejects malformed initiator (no colon)", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, initiator: "npc1" }),
    ).rejects.toThrow(/initiator/);
  });

  it("rejects malformed initiator (non-player-like)", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, initiator: "playerx" }),
    ).rejects.toThrow(/initiator/);
  });

  it("rejects toward with malformed EntityId entries", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, toward: ["npc:abc"] }),
    ).rejects.toThrow(/toward/);
  });

  it("accepts valid initiator (player)", async () => {
    const { server } = playerServer();
    // Should reach the engine — expect a result, not a refusal
    const res = await server.callTool("recordInteraction", {
      initiator: PLAYER,
      witnessSet: [npc(1)],
      content: "A quick chat.",
    });
    expect(res).not.toBeInstanceOf(Error);
  });

  it("accepts valid initiator (npc id)", async () => {
    const { server } = playerServer();
    const res = await server.callTool("recordInteraction", {
      initiator: npc(1),
      witnessSet: [PLAYER],
      content: "An npc-initiated chat.",
    });
    expect(res).not.toBeInstanceOf(Error);
  });

  it("accepts valid witnessSet with player and npc ids", async () => {
    const { server } = playerServer();
    const res = await server.callTool("recordInteraction", {
      initiator: PLAYER,
      witnessSet: [npc(2), npc(3)],
      content: "Witnessed by multiple.",
    });
    expect(res).not.toBeInstanceOf(Error);
  });

  it("accepts valid toward with npc ids", async () => {
    const { server } = playerServer();
    const res = await server.callTool("recordInteraction", {
      initiator: PLAYER,
      witnessSet: [npc(1)],
      toward: [npc(2)],
      content: "Interaction directed at someone.",
    });
    expect(res).not.toBeInstanceOf(Error);
  });

  it("rejects initiator with trailing colon but no number", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordInteraction", { ...validArgs, initiator: "npc:" }),
    ).rejects.toThrow(/initiator/);
  });
});
