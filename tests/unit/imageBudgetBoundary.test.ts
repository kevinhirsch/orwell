import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { IMAGE_BUDGET } from "../../src/engine/imageConstants";
import { buildSandbox } from "../support/sandbox";

// IMG-NEW-1 — the image-generation budget (`IMAGE_BUDGET`) was a DEAD constant: generation, the most
// expensive lever, was bounded by nothing. The cap is enforced in `recordImageBeat` and MUST be
// reachable over the MCP boundary (the four-place write-back template). Roles only — image refs are
// opaque strings, houseguests are engine ids.

function playerServer(): { server: McpServer; commands: EngineCommandsAdapter } {
  const sb = buildSandbox(1);
  const session = new GameSessionAdapter();
  const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
  const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  return { server, commands };
}

describe("IMG-NEW-1 — recordImageBeat enforces the generation budget over the MCP boundary", () => {
  it("the season-start move-in shoot is exempt: a first image per houseguest never trips the cap", async () => {
    const { server } = playerServer();
    // A full 16-houseguest cast move-in shoot — far past both caps — must all succeed (FIRST image each).
    for (let i = 0; i < 16; i++) {
      const res = (await server.callTool("recordImageBeat", {
        houseguestId: `npc:${i}`, imageRef: `move-in-${i}`,
      })) as { eventId: string };
      expect(res.eventId).toBeTruthy();
    }
  });

  it("RE-generations of an already-portrayed houseguest are metered and refused past the per-turn cap", async () => {
    const { server } = playerServer();
    // First image = exempt move-in portrait.
    await server.callTool("recordImageBeat", { houseguestId: "npc:1", imageRef: "move-in" });
    // The next `perTurnCap` re-shoots in the same turn window are metered but allowed.
    for (let i = 0; i < IMAGE_BUDGET.perTurnCap; i++) {
      const res = (await server.callTool("recordImageBeat", {
        houseguestId: "npc:1", imageRef: `re-shoot-${i}`,
      })) as { eventId: string };
      expect(res.eventId).toBeTruthy();
    }
    // The one past the cap is a deliberate engine refusal (so the FE loop stops re-shooting).
    await expect(
      server.callTool("recordImageBeat", { houseguestId: "npc:1", imageRef: "over-cap" }),
    ).rejects.toThrow(/budget/i);
  });

  it("the cap counts ACROSS houseguests within a turn (a backfill(force) re-shoot of the cast is bounded)", async () => {
    const { server } = playerServer();
    // Move-in every houseguest first (exempt), then re-shoot the cast in one turn (the backfill abuse).
    for (let i = 0; i < 6; i++) await server.callTool("recordImageBeat", { houseguestId: `npc:${i}`, imageRef: `move-in-${i}` });
    let allowed = 0;
    for (let i = 0; i < 6; i++) {
      try {
        await server.callTool("recordImageBeat", { houseguestId: `npc:${i}`, imageRef: `reshoot-${i}` });
        allowed++;
      } catch {
        /* refused past the cap */
      }
    }
    expect(allowed).toBe(IMAGE_BUDGET.perTurnCap); // exactly perTurnCap metered re-generations land, the rest refused
  });
});
