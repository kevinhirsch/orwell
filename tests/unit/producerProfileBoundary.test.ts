import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { producerForSeed } from "../../src/engine/producerPersona";
import { buildSandbox } from "../support/sandbox";

// #1626 increment 3 — the producer-DEEPENING write-back (`recordProducerProfile`). The four-place wiring
// gotcha (CLAUDE.md): a port method + adapter impl typecheck + pass the arch/manifest gates while the MCP
// dispatch case is missing, so the tool is DEAD at runtime. This proves the seam is open end to end — the
// FE can reach the write-back over the MCP boundary. Roles only (no houseguest names from any corpus).

describe("#1626 — the producer-deepening write-back reaches the engine over the MCP boundary", () => {
  function playerServer(): { server: McpServer; session: GameSessionAdapter } {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    return { server, session };
  }

  it("recordProducerProfile is on the player channel (the boundary bug)", () => {
    const names = PLAYER_TOOLS.map((t) => t.name);
    expect(names).toContain("recordProducerProfile");
  });

  it("dispatches recordProducerProfile — it is not rejected as 'not available' or 'unhandled tool'", async () => {
    const { server, session } = playerServer();
    const res = (await server.callTool("recordProducerProfile", {
      backstory: "A veteran of the casting desk who came up through the edit bay.",
      wit: "a dry, knowing aside timed right before the hard question",
    })) as { accepted: boolean; fields: string[] };
    expect(res.accepted).toBe(true);
    expect(res.fields).toEqual(expect.arrayContaining(["backstory", "wit"]));
    // The deepening DID land: the authored backstory is now voiced in the casting prompt.
    expect(session.getMomentPrompt({}).systemPrompt).toContain("came up through the edit bay");
  });

  it("keeps the seeded BYLINE stable across a deepening (the name never churns)", async () => {
    const { server, session } = playerServer();
    const before = session.getMomentPrompt({}).producerName;
    // A payload that even ECHOES a name must not move the byline (the name field is ignored by construction).
    const res = (await server.callTool("recordProducerProfile", {
      name: "Someone Else Entirely",
      backstory: "Runs the room like a chess opening.",
    })) as { accepted: boolean; fields: string[] };
    expect(res.accepted).toBe(true);
    expect(res.fields).not.toContain("name"); // name is never an accepted field
    const after = session.getMomentPrompt({}).producerName;
    expect(after).toBe(before);
    // And it is still the SEEDED producer's name (driven off the persisted producer seed).
    expect(after).toBe(producerForSeed(session.snapshot().producerSeed!).name);
  });

  it("dispatches with an empty payload (every field optional) — a clean no-op, never a 400", async () => {
    const { server } = playerServer();
    const res = (await server.callTool("recordProducerProfile", {})) as { accepted: boolean; reason?: string };
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe("empty");
  });

  it("refuses a malformed field (a non-string where a string is expected) with a typed field name", async () => {
    const { server } = playerServer();
    await expect(
      server.callTool("recordProducerProfile", { backstory: ["not", "a", "string"] }),
    ).rejects.toThrow(/backstory/);
  });

  it("rejects a payload attempting to inject stat/soul vocabulary (Vault-free by construction)", async () => {
    const { server, session } = playerServer();
    // A field carrying a stat-key substring / a decimal rating is stripped; nothing is folded.
    const res = (await server.callTool("recordProducerProfile", {
      disposition: "reads the room by their physical tells, rated 9.5 out of ten",
    })) as { accepted: boolean; reason?: string };
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe("rejected");
    // NOTHING was folded onto the producer — no authored overlay persists (the seeded floor stands).
    // (The Vault-vocab serialization scan of the merged producer itself is in producerPersona.test.ts;
    // the whole moment prompt legitimately contains those stat words in the base game-master glossary.)
    expect(session.snapshot().producerProfile).toBeUndefined();
  });
});
