import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER } from "../../src/domain/ids";

/**
 * L27 (critical requirement) — ALL summarized social play is stored in the engine and recallable
 * later, so story & narrative are built from the STORE recalled, never the chat window (ADR 0003 /
 * non-degradation #4). A recorded social scene must (1) land in the event record, (2) be indexed
 * into each participating houseguest's semantic recall memory (0024), and (3) survive a save/restore.
 * Roles only — no names asserted.
 */
describe("L27 — summarized social play is stored in the engine and recallable later", () => {
  it("a recorded scene lands in the record AND each houseguest's recall memory, and survives a restart", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("l27-user");
    sb.session.createCharacter({ playerName: "The Player", seed: 27 });
    const ally = sb.session.livingIds().find((id) => id !== PLAYER)!;

    const summary = "You and your ally schemed by the hammock about backdooring the Head of Household.";
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, ally], kind: "strategy", content: summary });

    // (1) STORED in the event record — retrievable; the player's own witnessed knowledge.
    expect(sb.engine.events.queryAll().some((e) => e.content === summary)).toBe(true);

    // (2) INDEXED into the houseguest's deepening soul memory (0024) — the recall substrate.
    expect(sb.engine.soul.soulOf(ally).memories.some((m) => m.content === summary)).toBe(true);
    // ...and semantically RECALLABLE (relevance, not recency) given a related cue.
    const recalled = sb.engine.soul.recall(ally, "the plan to backdoor the Head of Household", 5);
    expect(recalled.some((m) => m.content === summary)).toBe(true);

    // (3) SURVIVES persistence (non-degradation #4): still in the record after a save/restore.
    const core = sb.session.snapshot();
    sb.session.restore(core);
    expect(sb.engine.events.queryAll().some((e) => e.content === summary)).toBe(true);
  });

  it("an OOC scene the player was NOT in is refused (the recording seam is player-witnessed only)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("l27-ooc");
    sb.session.createCharacter({ playerName: "The Player", seed: 28 });
    const npcs = sb.session.livingIds().filter((id) => id !== PLAYER);
    // The player channel may only record scenes the player is part of — off-screen life is the engine's.
    expect(() =>
      sb.commands.recordInteraction({ initiator: npcs[0]!, witnessSet: [npcs[0]!, npcs[1]!], kind: "strategy", content: "secret" }),
    ).toThrow();
  });
});
