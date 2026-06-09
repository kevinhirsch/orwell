import { describe, it, expect } from "vitest";
import { classify } from "../../src/domain/event";
import type { GameEvent } from "../../src/domain/event";
import { PLAYER, npc } from "../../src/domain/ids";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { VisibleStateService } from "../../src/services/VisibleStateService";

describe("event visibility", () => {
  it("classifies strictly by the witness set", () => {
    const e: GameEvent = {
      id: "e", ts: 1, type: "conversation", initiator: PLAYER,
      witnessSet: [PLAYER, npc(1)], hidden: false, content: "x",
    };
    expect(classify(e, PLAYER)).toBe("VISIBLE");
    expect(classify(e, npc(1))).toBe("VISIBLE");
    expect(classify(e, npc(2))).toBe("HIDDEN");
  });

  it("VisibleStateService returns only events the entity witnessed", () => {
    const core = buildEngineCore();
    core.events.record({ id: "v", ts: 1, type: "conversation", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "seen" });
    core.events.record({ id: "h", ts: 2, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: "hidden" });
    const vss = new VisibleStateService(core.events, core.knowledge);
    expect(vss.getVisibleStateFor(PLAYER).visibleEvents.map((e) => e.id)).toEqual(["v"]);
  });

  it("surfacing adds a fact to knowledge with a traceable pathway and records the telling", () => {
    const core = buildEngineCore();
    // Anchored (A4): the teller must legitimately hold what they surface — seed npc:1's firsthand belief.
    core.knowledge.seedBelief(npc(1), { content: "gossip", factId: "g" }, "witnessed");
    core.knowledge.surfaceInformationTo(PLAYER, { content: "gossip" }, "told-by:npc:1");
    const known = core.knowledge.knownTo(PLAYER);
    expect(known).toHaveLength(1);
    expect(known[0]!.pathway).toBe("told-by:npc:1");
    expect(known[0]!.sourceEventId).toBeDefined();

    const vs = new VisibleStateService(core.events, core.knowledge).getVisibleStateFor(PLAYER);
    expect(vs.knowledge.map((k) => k.content)).toContain("gossip");
    expect(vs.visibleEvents.some((e) => e.type === "surfacing")).toBe(true);
  });
});
