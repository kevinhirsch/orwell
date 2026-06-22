import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { buildSandbox } from "../support/sandbox";
import { npc } from "../../src/domain/ids";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";

// Feature 0070 — off-screen society texture enrichment: the FE-driven prose write-back reaches the
// engine over the player MCP channel. Roles only (no names from any corpus).

describe("0070 — recordOffscreenSceneTexture is on the player channel (the boundary-bug proof)", () => {
  it("is listed in PLAYER_TOOLS", () => {
    const names = PLAYER_TOOLS.map((t) => t.name);
    expect(names).toContain("recordOffscreenSceneTexture");
  });
});

describe("0070 — the texture write-back reaches the engine over the MCP boundary", () => {
  function playerServer(): { server: McpServer; session: GameSessionAdapter; events: InMemoryEventStore } {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    // Wire the record provider so the adapter can find events.
    session.setRecordProviders({
      events: () => sb.engine.events.query(),
      hidden: () => [],
    });
    return { server, session, events: sb.engine.events as InMemoryEventStore };
  }

  it("dispatches recordOffscreenSceneTexture — not rejected as 'not available'", async () => {
    const { server, events } = playerServer();
    // Record a hidden off-screen event to enrich.
    const eventId = "texture-test-event-001";
    events.record({
      id: eventId,
      ts: 1,
      type: "conversation",
      initiator: npc(1),
      witnessSet: [npc(1), npc(2)],
      hidden: true,
      content: "two houseguests schemed together",
    });
    const res = (await server.callTool("recordOffscreenSceneTexture", {
      eventId,
      content: "The two houseguests leaned in over the kitchen counter, voices low. One of them floated a name — the same name they had both been thinking about.",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
  });

  it("returns ok:true for an unknown eventId (idempotent no-op, not an error)", async () => {
    const { server } = playerServer();
    const res = (await server.callTool("recordOffscreenSceneTexture", {
      eventId: "no-such-event-id-xyz",
      content: "enriched prose that will never land",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
  });

  it("returns ok:true for a player-witnessed (non-hidden) event id — content-only guard", async () => {
    const { server, events } = playerServer();
    // Record a player-witnessed event (NOT hidden — the player was present).
    const { PLAYER } = await import("../../src/domain/ids");
    const witnessedId = "player-witnessed-event-001";
    events.record({
      id: witnessedId,
      ts: 2,
      type: "conversation",
      initiator: PLAYER,
      witnessSet: [PLAYER, npc(3)],
      hidden: false,
      content: "the player spoke to a houseguest",
    });
    // The write-back must not touch the witnessed event (idempotent no-op, not an error).
    const res = (await server.callTool("recordOffscreenSceneTexture", {
      eventId: witnessedId,
      content: "This should NOT overwrite the witnessed event content.",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    // The original content is unchanged — the override map must not touch witnessed events.
    const found = events.query().find((e) => e.id === witnessedId);
    expect(found?.content).toBe("the player spoke to a houseguest");
  });

  it("requires a non-empty eventId (shape guard)", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordOffscreenSceneTexture", { eventId: "", content: "some prose" }),
    ).rejects.toThrow(/eventId/);
  });

  it("requires a non-empty content (shape guard)", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordOffscreenSceneTexture", { eventId: "some-id", content: "" }),
    ).rejects.toThrow(/content/);
  });
});

describe("0070 — the texture write-back is content-only (closed-set is immutable)", () => {
  it("the witness set and hidden flag of the enriched event are unchanged after write-back", async () => {
    const sb = buildSandbox(2);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    session.setRecordProviders({
      events: () => sb.engine.events.query(),
      hidden: () => [],
    });

    const eventId = "closed-set-guard-event-001";
    (sb.engine.events as InMemoryEventStore).record({
      id: eventId,
      ts: 1,
      type: "conversation",
      initiator: npc(1),
      witnessSet: [npc(1), npc(2)],
      hidden: true,
      content: "original deterministic template content",
    });

    const before = sb.engine.events.query().find((e) => e.id === eventId);
    const beforeWitnesses = [...(before?.witnessSet ?? [])];
    const beforeHidden = before?.hidden;

    await server.callTool("recordOffscreenSceneTexture", {
      eventId,
      content: "enriched voiced texture — vivid prose, but no closed-set change",
    });

    const after = sb.engine.events.query().find((e) => e.id === eventId);
    // Witness set and hidden flag must be byte-identical after enrichment.
    expect(after?.witnessSet).toEqual(beforeWitnesses);
    expect(after?.hidden).toBe(beforeHidden);
    // The original stored content is also unchanged (the override lives in the adapter map).
    expect(after?.content).toBe("original deterministic template content");
  });
});
