import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { VisibleStateService } from "../../src/services/VisibleStateService";
import { recallWitnessedMoments, type RecallCandidate } from "../../src/engine/memoryCallback";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { buildSandbox } from "../support/sandbox";
import { PLAYER, npc } from "../../src/domain/ids";
import type { GameEvent } from "../../src/domain/event";

/**
 * Feature #1394 — the MCP boundary test (the four-place-wiring gotcha from CLAUDE.md). A port method
 * that is implemented but not (3) registered + (4) dispatched is DEAD at runtime with nothing failing.
 * This proves the seam is open end to end: the FE can reach `recallSceneMemories` over the MCP boundary,
 * it dispatches (never "not available"/"unhandled tool"), it shape-guards its optional args, and its
 * result is Vault-free (it flows from the visible projection the session is wired to). Roles only.
 */

const embed = (t: string) => new DeterministicEmbedding().embed(t);
const asCandidate = (e: GameEvent): RecallCandidate =>
  ({ id: e.id, ts: e.ts, content: e.content, initiator: e.initiator, witnessSet: e.witnessSet });

function playerServer() {
  const sb = buildSandbox(3);
  const visible = new VisibleStateService(sb.engine.events, sb.engine.knowledge);
  const session = new GameSessionAdapter();
  // Wire recall from the Vault-free projection, exactly as the registry does.
  session.setSceneRecall((npcIds, cue) =>
    recallWitnessedMoments({
      events: visible.getVisibleStateFor(PLAYER).visibleEvents.map(asCandidate),
      npcIds, cue, embed,
    }).moments,
  );
  const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
  const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  return { sb, server };
}

describe("#1394 — recallSceneMemories reaches the engine over the MCP boundary", () => {
  it("recallSceneMemories is on the player channel", () => {
    expect(PLAYER_TOOLS.map((t) => t.name)).toContain("recallSceneMemories");
  });

  it("dispatches — it is not rejected as 'not available' or 'unhandled tool'", async () => {
    const { sb, server } = playerServer();
    // A witnessed player↔NPC scene the recall can surface (no sentinel — witnessed content).
    sb.engine.events.record({
      id: "b:promise", ts: 6000, type: "conversation", hidden: false,
      initiator: PLAYER, witnessSet: [PLAYER, npc(2)],
      content: "you told the ally at the veto ceremony you'd never write their name",
    });
    const res = (await server.callTool("recallSceneMemories", {
      withIds: [npc(2)], cue: "the veto ceremony and writing their name",
    })) as { moments: string[] };
    expect(Array.isArray(res.moments)).toBe(true);
    expect(res.moments.join("\n")).toContain("never write their name");
    // Vault-free: no sandbox sentinel can appear in a recall result.
    for (const s of sb.sentinels) expect(res.moments.join("\n")).not.toContain(s);
  });

  it("dispatches with empty/absent args and returns { moments: [] } (enrichment absence is not a failure)", async () => {
    const { server } = playerServer();
    expect((await server.callTool("recallSceneMemories", {})) as { moments: string[] }).toEqual({ moments: [] });
    expect(
      (await server.callTool("recallSceneMemories", { withIds: [], cue: "" })) as { moments: string[] },
    ).toEqual({ moments: [] });
  });

  it("shape-guards a malformed withIds with a typed field name (never a 500 blind cast)", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recallSceneMemories", { withIds: "not-an-array", cue: "x" }),
    ).rejects.toThrow(/withIds/);
  });

  it("shape-guards a malformed cue with a typed field name", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recallSceneMemories", { withIds: [npc(1)], cue: 42 }),
    ).rejects.toThrow(/cue/);
  });
});
