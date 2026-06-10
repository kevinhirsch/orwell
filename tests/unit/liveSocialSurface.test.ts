import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { deriveNpcKnowledge } from "../../src/engine/diaryRoom";
import { PLAYER } from "../../src/domain/ids";

// Feature 0036: the two built-but-unwired social capabilities are now live player tools.
// We drive them through the actual MCP player channel (the live tool path).

const sandboxWithGame = () => {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor("user-a");
  sb.session.createCharacter({ playerName: "Player", seed: 11 });
  return sb;
};

describe("0036 — socialInitiatives (NPC-initiated approaches)", () => {
  it("returns houseguests who want to approach the player — names + a coarse motive only (E60)", async () => {
    const sb = sandboxWithGame();
    const out = (await sb.mcp.player.callTool("socialInitiatives")) as Array<{ houseguest: { id: string; name: string }; motive: string }>;

    expect(out.length).toBeGreaterThan(0); // the house reaches out — scenes are bidirectional
    for (const it of out) {
      expect(typeof it.houseguest.name).toBe("string");
      expect(it.houseguest.name.length).toBeGreaterThan(0);
      // ADR 0003: the engine hands the GM the categorical FACT to voice, never a canned line.
      expect(["bond", "probe"]).toContain(it.motive);
    }
    // The canned pretext is gone — no scripted sentence ships in the projection.
    expect(JSON.stringify(out)).not.toContain("wants a word");
  });

  it("never leaks the hidden drive (no trust/threat number crosses the wall)", async () => {
    const sb = sandboxWithGame();
    const out = await sb.mcp.player.callTool("socialInitiatives");
    // The Approach.drive (a relationship-derived number) must not appear in the projected shape.
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/drive/i);
    expect(json).not.toMatch(/trust|affinity|threat/i);
  });

  it("is empty before a game starts", async () => {
    const reg = new GameSessionRegistry();
    const out = await reg.sandboxFor("nobody").mcp.player.callTool("socialInitiatives");
    expect(out).toEqual([]);
  });
});

describe("0036 — diaryRoom (the player's OOC channel, walled from NPCs)", () => {
  it("records the entry as the player's own knowledge", async () => {
    const sb = sandboxWithGame();
    const res = await sb.mcp.player.callTool("diaryRoom", { entry: "I am quietly targeting the HOH" });
    expect(res).toEqual({ recorded: true });

    const known = sb.player.getVisibleState().knowledge.map((k) => k.content);
    expect(known).toContain("I am quietly targeting the HOH");
  });

  it("no houseguest can ever learn the Diary-Room content", async () => {
    const sb = sandboxWithGame();
    const SECRET = "DR_SECRET_no_npc_may_know";
    await sb.mcp.player.callTool("diaryRoom", { entry: SECRET });

    // 1) The recorded DR event witnesses the PLAYER alone — no NPC was present.
    const drEvent = sb.engine.events.query().find((e) => e.type === "diary-room");
    expect(drEvent).toBeDefined();
    expect(drEvent!.witnessSet).toEqual([PLAYER]);

    // 2) Even if the DR fact were offered to NPC-knowledge derivation, the wall drops it (0013).
    const drFact = sb.player.getVisibleState().knowledge.find((k) => k.content === SECRET);
    expect(drFact).toBeDefined();
    expect(deriveNpcKnowledge([drFact!])).toEqual([]);
  });
});
