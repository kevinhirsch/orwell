import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { PLAYER_TOOLS, PLAYER_AGENT_LEVERS, toolsFor } from "../../src/surfaces/tools/registry";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Audit E20 — `resolveCompetition` was a seed-shopping oracle on the player channel: the caller
 * supplied participants WITH stats and the seed, nothing was recorded, nothing folded. It is gone
 * from the channel; `runCompetition` (the live house, engine stats, recorded beat) has been the
 * single outcome authority since B37. HARD rule: roles only — no names.
 */
describe("E20 — resolveCompetition is off the player channel", () => {
  it("is absent from the tool registry and the agent lever manifest", () => {
    expect(PLAYER_TOOLS.some((t) => t.name === "resolveCompetition")).toBe(false);
    expect(PLAYER_AGENT_LEVERS).not.toContain("resolveCompetition");
    expect(toolsFor("admin/God Mode").some((t) => t.name === "resolveCompetition")).toBe(false);
    // The one competition authority is still advertised.
    expect(PLAYER_TOOLS.some((t) => t.name === "runCompetition")).toBe(true);
  });

  it("is refused by callTool on both channels", async () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("u");
    sb.session.createCharacter({ playerName: "P", seed: 3 });
    const args = {
      type: "endurance",
      participants: [{ id: PLAYER, stats: { physical: 0.9, mental: 0.9, social: 0.9 } }],
      intents: [], seed: 1,
    };
    await expect(sb.mcp.player.callTool("resolveCompetition", args)).rejects.toThrow(/not available/);
    await expect(sb.mcp.admin.callTool("resolveCompetition", args)).rejects.toThrow(/not available/);
  });
});

/**
 * Audit E21 — `recordInteraction` is the PLAYER channel's recording seam. It could mint hidden
 * (Vault-layer) events (a witness set excluding the player) and pump hidden edges without bound
 * (the per-call fold cap reset every call). Now: the witness set must include the player, and
 * folds are budgeted per beat per directed edge.
 */
describe("E21 — the player-channel witness rule", () => {
  it("a witness set excluding the player throws — the channel cannot mint off-screen ground truth", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    expect(() =>
      cmd.recordInteraction({ initiator: npc(1), witnessSet: [npc(1), npc(2)], content: "a fabricated off-screen scheme" }),
    ).toThrow(/witness set must include the player/);
    expect(core.events.query()).toHaveLength(0); // nothing recorded, hidden or otherwise
  });

  it("the player initiating IS being in the scene: their seat is made explicit and the event is never hidden", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    const { eventId } = cmd.recordInteraction({ initiator: PLAYER, witnessSet: [npc(1)], content: "a hallway aside" });
    const ev = core.events.query().find((e) => e.id === eventId)!;
    expect(ev.witnessSet).toContain(PLAYER);
    expect(ev.hidden).toBe(false); // player-witnessed is never secret (0002)
  });
});

describe("E21 — the per-beat fold budget bounds repeated identical calls", () => {
  it("N identical calls move an edge no further than the budget; the events still record", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);

    const calls = 20;
    let afterBudget = "";
    for (let i = 0; i < calls; i++) {
      cmd.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "the same flattering chat", kind: "bonding",
      });
      if (i === 2) afterBudget = JSON.stringify(core.relationships.serialize()); // budget = 3 folds/pair/beat
    }
    // Every scene recorded (it happened) …
    expect(core.events.query({ type: "conversation" })).toHaveLength(calls);
    // … but the hidden edge stopped moving once the beat's budget for that pair was spent.
    expect(JSON.stringify(core.relationships.serialize())).toBe(afterBudget);
  });

  it("the budget re-opens when the loop advances to the next beat", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);

    for (let i = 0; i < 10; i++) {
      cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat", kind: "bonding" });
    }
    const spent = JSON.stringify(core.relationships.serialize());

    // A resolved season beat lands in the record (how the registry stores every loop beat) …
    core.events.record({
      id: `season:${core.events.query().length}`, ts: core.events.query().length,
      type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "a ceremony resolves",
    });
    // … and the SAME interaction folds again: a new beat, a fresh budget.
    cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat", kind: "bonding" });
    expect(JSON.stringify(core.relationships.serialize())).not.toBe(spent);
  });
});
