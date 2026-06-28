import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS, PLAYER_AGENT_LEVERS } from "../../src/surfaces/tools/registry";
import { buildSandbox } from "../support/sandbox";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { ExposeResult, TradeResult } from "../../src/ports/GameSession";

/**
 * Features 0093 + 0099 — the BOUNDARY test (the four-place wiring gate). The static gates MISS a missing
 * McpServer dispatch (#4): a lever wired in the port + adapter + registry but NOT dispatched typechecks,
 * passes test:arch + the manifest drift test, and is DEAD at runtime. This dispatches `exposeSecret` and
 * `tradeSecret` THROUGH `McpServer.callTool` so a missing dispatch FAILS here. (Templates:
 * `tests/unit/castPrewarm.test.ts`, `tests/unit/worldSnapshotBoundary.test.ts`.) Roles only — no names.
 */

/** Wire a player-channel server with the secrets-as-power seams the composition root wires (by hand here). */
function playerServer(seed: number): { server: McpServer; session: GameSessionAdapter; sb: ReturnType<typeof buildSandbox> } {
  const sb = buildSandbox(seed);
  const session = new GameSessionAdapter();
  // Mirror registry.ts: the player-knowledge reader + the surface-to-houseguest pathway.
  session.setPlayerKnowledgeReader(() =>
    sb.engine.knowledge.knownTo(PLAYER).map((f) => ({ id: f.id, content: f.content, subject: f.subject, factId: f.factId })),
  );
  session.setOnSurfaceToHouseguest((npcId, content, subject, pathway, confidence) => {
    const factId = `secret-power:${npcId}:${sb.engine.events.count()}`;
    sb.engine.knowledge.seedBelief(npcId, { content, originalContent: content, factId, confidence: 0.9, hops: 0, distortion: 0, source: PLAYER }, "origin");
    return sb.engine.knowledge.surfaceInformationTo(npcId, { content, subject, confidence }, pathway) !== null;
  });
  const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
  const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  return { server, session, sb };
}

/** Plant a learned secret about the first NPC into the player's knowledge; return that NPC's id + the factId. */
function learnSecretAboutFirstNpc(session: GameSessionAdapter, sb: ReturnType<typeof buildSandbox>): { subject: EntityId; factId: string } {
  const subject = session.livingIds().find((id) => id !== PLAYER)!;
  const factId = `learned:${subject}`;
  // Seed the NPC holding it, then surface it to the player as their KNOWLEDGE (a real pathway).
  sb.engine.knowledge.seedBelief(subject, { content: "a learned secret about them", originalContent: "a learned secret about them", factId, confidence: 0.9, hops: 0, distortion: 0, source: subject }, "origin");
  sb.engine.knowledge.surfaceInformationTo(PLAYER, { content: "a learned secret about them", subject, confidence: 0.85 }, `told-by:${subject}`);
  const fact = sb.engine.knowledge.knownTo(PLAYER).find((f) => f.subject === subject)!;
  return { subject, factId: fact.factId ?? fact.id };
}

describe("0093/0099 — exposeSecret + tradeSecret are on the player channel + in the lever manifest", () => {
  it("both are advertised player tools (the boundary bug: missing from PLAYER_TOOLS)", () => {
    const names = PLAYER_TOOLS.map((t) => t.name);
    expect(names).toContain("exposeSecret");
    expect(names).toContain("tradeSecret");
  });

  it("both are MODEL levers (in the agent lever manifest, not FE-only infra)", () => {
    expect(PLAYER_AGENT_LEVERS).toContain("exposeSecret");
    expect(PLAYER_AGENT_LEVERS).toContain("tradeSecret");
  });
});

describe("0093/0099 — the levers DISPATCH through McpServer.callTool (the missing-#4 gate)", () => {
  it("exposeSecret dispatches a learned secret and is NOT rejected as 'not available' or dead", async () => {
    const { server, session, sb } = playerServer(1);
    session.createCharacter({ playerName: "The Player", seed: 1 });
    const { factId } = learnSecretAboutFirstNpc(session, sb);
    const res = (await server.callTool("exposeSecret", { factId })) as ExposeResult;
    expect(res).toBeTruthy();
    expect(res.exposed).toBe(true); // the engine actually resolved it — not a silent no-op (#4 wired)
  });

  it("tradeSecret dispatches a learned secret to a recipient and is NOT rejected", async () => {
    const { server, session, sb } = playerServer(2);
    session.createCharacter({ playerName: "The Player", seed: 2 });
    const { subject, factId } = learnSecretAboutFirstNpc(session, sb);
    const recipient = session.livingIds().find((id) => id !== PLAYER && id !== subject)!;
    const res = (await server.callTool("tradeSecret", { factId, toNpcId: recipient, askKind: "vote" })) as TradeResult;
    expect(res).toBeTruthy();
    expect(typeof res.accepted).toBe("boolean"); // the engine resolved it (accepted or declined) — dispatched
  });

  it("makeDeal dispatches WITH a leverage descriptor (the optional secret rides the existing tool)", async () => {
    const { server, session, sb } = playerServer(3);
    session.createCharacter({ playerName: "The Player", seed: 3 });
    const { subject, factId } = learnSecretAboutFirstNpc(session, sb);
    // Leverage is about the deal PARTNER (the subject of the held secret).
    const res = (await server.callTool("makeDeal", { with: subject, kind: "safety", terms: "keep me safe", leverage: { factId } })) as { id: string } | null;
    expect(res).toBeTruthy();
    expect(res!.id).toBeTruthy(); // the deal still forms (additive); leverage colored it
  });

  it("the arg-guard refuses a malformed call with a 400-shaped field error, never a 500", async () => {
    const { server, session } = playerServer(4);
    session.createCharacter({ playerName: "The Player", seed: 4 });
    // No factId and no bluff ⇒ the requireShape guard refuses (a deliberate field error, not a blind cast).
    await expect(server.callTool("exposeSecret", {})).rejects.toThrow(/factId/);
    await expect(server.callTool("tradeSecret", { toNpcId: "npc:x" })).rejects.toThrow(/factId/);
  });
});
