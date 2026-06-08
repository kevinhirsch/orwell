import { describe, it, expect } from "vitest";
import { deriveNpcKnowledge, playerStrategyRead, producerPrompt, isNpcReachable, NO_NPC_PATHWAY } from "../../src/engine/diaryRoom";
import { buildSandbox } from "../support/sandbox";
import { PLAYER, npc } from "../../src/domain/ids";

describe("0013 — Diary Room → no NPC wall", () => {
  it("DR content is the player's knowledge, tagged no-NPC-pathway, and reaches no NPC", () => {
    const sb = buildSandbox(1);
    const content = "my real plan to backdoor the HOH";
    sb.engine.knowledge.recordDiaryRoom(content);

    const playerKnown = sb.engine.knowledge.knownTo(PLAYER);
    const dr = playerKnown.find((k) => k.content === content);
    expect(dr).toBeDefined();
    expect(dr!.pathway).toBe(NO_NPC_PATHWAY);
    expect(isNpcReachable(dr!)).toBe(false);

    // No NPC's knowledge ever contains it.
    for (let i = 1; i <= 8; i++) {
      expect(sb.engine.knowledge.knownTo(npc(i)).some((k) => k.content === content)).toBe(false);
    }
    // The engine's player-strategy read MAY consume it; NPC derivation MUST NOT.
    expect(playerStrategyRead(playerKnown).some((k) => k.content === content)).toBe(true);
    expect(deriveNpcKnowledge(playerKnown).some((k) => k.content === content)).toBe(false);
  });

  it("deriveNpcKnowledge keeps NPC-reachable facts but strips DR-tagged ones", () => {
    const facts = [
      { id: "a", content: "witnessed thing", pathway: "witnessed", ts: 1 },
      { id: "b", content: "told thing", pathway: "told-by:npc:2", ts: 2 },
      { id: "c", content: "dr thing", pathway: NO_NPC_PATHWAY, ts: 3 },
    ];
    const derived = deriveNpcKnowledge(facts);
    expect(derived.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("0013 — producer prompts fire at dramatic beats, not every turn", () => {
  it("invites only on dramatic beats", () => {
    expect(producerPrompt("position-shift").invite).toBe(true);
    expect(producerPrompt("eviction").invite).toBe(true);
    expect(producerPrompt("nomination").invite).toBe(true);
    expect(producerPrompt("veto-ceremony").invite).toBe(true);
    expect(producerPrompt("routine-chat").invite).toBe(false);
    expect(producerPrompt("idle").invite).toBe(false);
    expect(producerPrompt("downtime").invite).toBe(false);
  });

  it("does not fire on every turn over a stream", () => {
    const stream = ["routine-chat", "idle", "nomination", "downtime", "eviction", "routine-chat"] as const;
    const invited = stream.filter((b) => producerPrompt(b).invite);
    expect(invited.length).toBe(2);
    expect(invited.length).toBeLessThan(stream.length);
  });
});
