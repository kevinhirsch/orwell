import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import {
  ADMIN_TOOLS, PLAYER_TOOLS, DEBUG_VAULT_TOOL_NAMES, toolsFor,
} from "../../src/surfaces/tools/registry";
import { npc, PLAYER } from "../../src/domain/ids";

/**
 * ADM-NEW-3 (#589) — the AdminPort and the player channel SHARE one `McpDeps` (the same
 * `deps.session`/`deps.player`/`deps.commands` is handed to BOTH `new McpServer("player", deps)` and
 * `("admin/God Mode", deps)`). Player-private content and the Vault are PHYSICALLY reachable from those
 * shared deps; the only thing stopping the admin channel from dispatching a player-content tool is the
 * `allows() → toolsFor → ADMIN_TOOLS` allowlist (and `readsVault:false` does NOT catch it — the player-
 * content tools are also `readsVault:false`). Correct as written today, but one prose-allowlist deep.
 *
 * These boundary tests PARTITION the admin channel from player-private + Vault content so a future
 * mis-registered admin tool sourcing player content (or `deps.session`) is caught structurally:
 *   (1) the admin allowlist is name-disjoint from the player allowlist (no shared tool),
 *   (2) the admin channel REFUSES every player-content tool even though it is reachable on shared deps,
 *   (3) the ONLY admin-channel tool permitted to reach `deps.session` is the sanctioned `producerVault`
 *       (the owner-ruled mandate-#2 debug exception); every other admin tool reads only `deps.admin`,
 *   (4) admin tool OUTPUT carries no player-private or Vault sentinel (producerVault excepted).
 *
 * HARD rule: roles only — no fixture names asserted as canonical.
 */

const PLAYER_PRIVATE = "SENTINEL-player-private-diary";
const PLAYER_VISIBLE = "SENTINEL-player-visible-scene";
const VAULT_SECRET = "SENTINEL-vault-offscreen-secret";

/** Player-content tools that are PHYSICALLY reachable from the shared deps but must be admin-walled. */
const PLAYER_CONTENT_TOOLS = [
  "getVisibleStateFor", // deps.player.getVisibleState — the player's own knowledge
  "seasonRetrospective", // deps.session.seasonRetrospective — the unsealed hidden story
  "npcVoice",            // deps.session.npcVoice — a houseguest's knowledge-bounded voicing
  "getMomentPrompt",     // deps.session.getMomentPrompt — the player's managed prompt
  "renderScene",         // deps.player.produce — player-facing narration
  "diaryRoom",           // deps.commands.diaryRoom — the player's OOC knowledge
  "seasonRecap",         // deps.session.seasonRecap — the player's public arc
] as const;

function liveSandbox(user: string, seed: number): ReturnType<GameSessionRegistry["sandboxFor"]> {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return sb;
}

/** Plant player-private content, a player-WITNESSED (not secret) scene, and a Vault secret. */
function plantContent(sb: ReturnType<GameSessionRegistry["sandboxFor"]>): void {
  // Player-private OOC knowledge (no NPC pathway).
  sb.engine.events.record({
    id: "ap-diary", ts: 9_200_001, type: "diary-room",
    initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: PLAYER_PRIVATE,
  });
  // A player-WITNESSED scene (the player's knowledge — not secret).
  sb.engine.events.record({
    id: "ap-visible", ts: 9_200_002, type: "conversation",
    initiator: PLAYER, witnessSet: [PLAYER, npc(1)], hidden: false, content: PLAYER_VISIBLE,
  });
  // A genuinely off-screen Vault secret (witness set excludes the player).
  sb.engine.events.record({
    id: "ap-offscreen", ts: 9_200_003, type: "conversation",
    initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: VAULT_SECRET,
  });
  sb.engine.vault.writeHidden({ id: "ap-vault", kind: "hidden-attribute", content: VAULT_SECRET });
}

describe("ADM-NEW-3 (#589) — admin/God-Mode is partitioned from player-private + Vault content", () => {
  it("(1) the admin allowlist is name-disjoint from the player allowlist (no shared tool)", () => {
    const playerNames = new Set(PLAYER_TOOLS.map((t) => t.name));
    for (const t of ADMIN_TOOLS) {
      expect(playerNames.has(t.name), `admin tool "${t.name}" must NOT also be a player tool`).toBe(false);
    }
    // Symmetric: no player tool is an admin tool either.
    const adminNames = new Set(ADMIN_TOOLS.map((t) => t.name));
    for (const t of PLAYER_TOOLS) {
      expect(adminNames.has(t.name), `player tool "${t.name}" must NOT also be an admin tool`).toBe(false);
    }
    // And every player-content tool we partition against IS a real player tool (the list stays honest).
    for (const name of PLAYER_CONTENT_TOOLS) {
      expect(playerNames.has(name), `"${name}" should be a player-channel tool`).toBe(true);
    }
  });

  it("(2) the admin channel REFUSES every player-content tool — though it is reachable on shared deps", async () => {
    const sb = liveSandbox("ap-refuse", 7);
    plantContent(sb);
    for (const name of PLAYER_CONTENT_TOOLS) {
      // Refused at the allowlist boundary BEFORE any dispatch — never reaches the shared deps.
      await expect(
        sb.mcp.admin.callTool(name, { id: npc(1) }),
        `admin channel must refuse player-content tool "${name}"`,
      ).rejects.toThrow();
      // Sanity: the SAME tool IS available on the player channel (proving it's reachable on the deps).
      expect(toolsFor("player").some((t) => t.name === name)).toBe(true);
    }
  });

  it("(3) producerVault is the ONLY admin tool permitted to reach deps.session", () => {
    // Every ADVERTISED admin tool reads deps.admin; the lone deps.session reader is the quarantined,
    // out-of-band debug exception — and it is NOT in the advertised admin allowlist.
    for (const t of ADMIN_TOOLS) {
      expect(DEBUG_VAULT_TOOL_NAMES.has(t.name), `"${t.name}" must not be a debug Vault tool`).toBe(false);
    }
    expect([...DEBUG_VAULT_TOOL_NAMES]).toEqual(["producerVault"]);
    expect(toolsFor("admin/God Mode").some((t) => t.name === "producerVault")).toBe(false);
  });

  it("(4) admin tool output carries no player-private or Vault sentinel (producerVault excepted)", async () => {
    const sb = liveSandbox("ap-output", 7);
    plantContent(sb);
    // Drive every ADVERTISED admin tool and prove its Vault-free output never leaks a sentinel.
    const outputs: unknown[] = [
      await sb.mcp.admin.callTool("inspectNonVaultState", {}),
      await sb.mcp.admin.callTool("sandboxHealth", {}),
      await sb.mcp.admin.callTool("configure", {}),
      await sb.mcp.admin.callTool("setTimeOfDay", { enabled: false }),
      await sb.mcp.admin.callTool("overrideMechanic", { mechanic: "noop", value: 1 }),
    ];
    for (const out of outputs) {
      const json = JSON.stringify(out) ?? "";
      expect(json).not.toContain(PLAYER_PRIVATE);
      expect(json).not.toContain(PLAYER_VISIBLE);
      expect(json).not.toContain(VAULT_SECRET);
    }
    // The sanctioned exception DOES unseal the Vault (proving the planted secret is genuinely reachable —
    // so tests (2)/(4) above are meaningful, not vacuous): producerVault is the one permitted breach.
    const unseal = await sb.mcp.admin.callTool("producerVault", {});
    expect(JSON.stringify(unseal)).toContain(VAULT_SECRET);
    // And the player channel can NEVER unseal it (the breach is admin-only).
    await expect(sb.mcp.player.callTool("producerVault", {})).rejects.toThrow();
  });
});
