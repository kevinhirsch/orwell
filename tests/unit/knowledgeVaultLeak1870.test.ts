import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import {
  PLAYER_TOOLS, PLAYER_AGENT_LEVERS, toolsFor,
} from "../../src/surfaces/tools/registry";
import { npc } from "../../src/domain/ids";

/**
 * Issue #1870 — Vault Wall transport quarantine.
 *
 * R-VLT-5 (docs/audits/2026-07-22-full-repo-audit-backlog.md):
 * `knowledgeScopeManifest` was on the PLAYER channel (registry.ts:40), and `INFRA_LEVERS:199-202`
 * only kept it out of the MODEL's prose manifest, not the channel. The FE fetches it once per turn
 * through `orwell_engine._call`, whose I/O tap copies the FULL response (including NPC-only secret
 * content — confides, gossip-diffused beliefs, off-screen surfacings) into the god/God-Mode-readable
 * io ring every turn. `sealedFromHouse` (registry.ts:39) is smaller-impact (player's own knowledge
 * only) but moved out-of-band per the same finding.
 *
 * Fix: both tools are REMOVED from the PLAYER_TOOLS array (so `listTools()` and `toolsFor("player")`
 * do NOT advertise them). They remain reachable through `McpServer.callTool` via the same
 * `INFRA_TOOL_NAMES` out-of-band dispatch pattern `producerVault` uses on the admin channel.
 * Additionally, `_call()` in orwell_engine.py strips the response payload from io-ring recording
 * for these two tools (sealing the god/God-Mode tap that was leaking NPC-only content).
 *
 * These tests prove (1) the quarantine from the advertised player channel, (2) the tools are STILL
 * dispatchable through the MCP boundary despite being unadvertised.
 */

const SENTINEL = "SENTINEL_1870_bounded_secret";
const DIARY_SENTINEL = "SENTINEL_1870_diary_secret";

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("Issue #1870 — Vault Wall: knowledgeScopeManifest/sealedFromHouse transport quarantine", () => {
  it("knowledgeScopeManifest is NOT in the player channel's advertised tool list", () => {
    expect(PLAYER_TOOLS.some((t) => t.name === "knowledgeScopeManifest")).toBe(false);
    expect(toolsFor("player").some((t) => t.name === "knowledgeScopeManifest")).toBe(false);
  });

  it("sealedFromHouse is NOT in the player channel's advertised tool list", () => {
    expect(PLAYER_TOOLS.some((t) => t.name === "sealedFromHouse")).toBe(false);
    expect(toolsFor("player").some((t) => t.name === "sealedFromHouse")).toBe(false);
  });

  it("PLAYER_AGENT_LEVERS does NOT contain either tool (they're infra-only)", () => {
    expect(PLAYER_AGENT_LEVERS).not.toContain("knowledgeScopeManifest");
    expect(PLAYER_AGENT_LEVERS).not.toContain("sealedFromHouse");
  });

  it("knowledgeScopeManifest is still dispatchable through the MCP boundary despite being unadvertised", async () => {
    const { sb } = liveGame("1870-ksm-dispatch", 4);
    // Plant a bounded fact via a seeded belief for npc(2) — witnessed only by npc(2) and npc(3)
    sb.engine.knowledge.seedBelief(npc(2), { content: SENTINEL, factId: "1870:b" }, "witnessed");

    // knowledgeScopeManifest must NOT throw even though it's not in the advertised list
    const result = (await sb.mcp.player.callTool("knowledgeScopeManifest", {})) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    const blob = JSON.stringify(result);
    expect(blob).toContain(SENTINEL);
  });

  it("sealedFromHouse is still dispatchable through the MCP boundary despite being unadvertised", async () => {
    const { sb } = liveGame("1870-sfh-dispatch", 6);
    // Record a diary-room entry (player's own knowledge, sealed from all houseguests)
    sb.engine.knowledge.recordDiaryRoom(DIARY_SENTINEL);

    // sealedFromHouse must NOT throw even though it's not in the advertised list
    const result = (await sb.mcp.player.callTool("sealedFromHouse", {})) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    const blob = JSON.stringify(result);
    expect(blob).toContain(DIARY_SENTINEL);
  });

  it("both tools return empty/empty-adjacent states before a game is started", async () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("1870-empty");
    // No game started — knowledgeScopeManifest should return empty
    const ksm = (await sb.mcp.player.callTool("knowledgeScopeManifest", {})) as unknown[];
    expect(Array.isArray(ksm)).toBe(true);
    // sealedFromHouse should return empty
    const sfh = (await sb.mcp.player.callTool("sealedFromHouse", {})) as unknown[];
    expect(Array.isArray(sfh)).toBe(true);
  });
});
