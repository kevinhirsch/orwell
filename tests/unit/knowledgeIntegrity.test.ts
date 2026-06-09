import { describe, it, expect } from "vitest";
import { buildEngineCore } from "../../src/composition/engineRoot";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature B39 / audit A4 — the narrator may not mint ground truth. A surfacing must trace to a real
 * source (the teller holds/witnessed it, or the overheard event exists), else it is downgraded to a
 * suspicion; a recorded interaction may only name living houseguests. HARD rule: roles only — no names.
 */
describe("B39 — anchored surfacing (anti-sycophancy)", () => {
  it("an anchored told-by surfacing enters knowledge; an invented one becomes a suspicion", () => {
    const core = buildEngineCore();
    core.knowledge.seedBelief(npc(1), { content: "a real secret", factId: "s" }, "witnessed"); // the teller holds it

    const real = core.knowledge.surfaceInformationTo(PLAYER, { content: "a real secret" }, "told-by:npc:1");
    expect(real).not.toBeNull();
    expect(core.knowledge.knownTo(PLAYER).some((k) => k.content === "a real secret")).toBe(true);

    // npc:1 does NOT hold this — the narrator invented the source ⇒ downgraded, never knowledge.
    const invented = core.knowledge.surfaceInformationTo(PLAYER, { content: "an invented secret" }, "told-by:npc:1");
    expect(invented).toBeNull();
    expect(core.knowledge.knownTo(PLAYER).some((k) => k.content === "an invented secret")).toBe(false);
    expect(core.knowledge.suspicionsOf(PLAYER).some((s) => s.content === "an invented secret")).toBe(true);
  });

  it("a teller who WITNESSED an event may surface it; overheard requires a real event", () => {
    const core = buildEngineCore();
    core.events.record({ id: "scene:1", ts: 1, type: "conversation", initiator: npc(2), witnessSet: [npc(2), npc(3)], hidden: true, content: "they schemed" });

    // npc:2 witnessed "they schemed" → may legitimately tell it.
    expect(core.knowledge.surfaceInformationTo(PLAYER, { content: "they schemed" }, "told-by:npc:2")).not.toBeNull();
    // overheard a real event id → anchored; a non-existent event id → suspicion.
    expect(core.knowledge.surfaceInformationTo(PLAYER, { content: "overheard line" }, "overheard:scene:1")).not.toBeNull();
    expect(core.knowledge.surfaceInformationTo(PLAYER, { content: "nope" }, "overheard:no-such-event")).toBeNull();
  });

  it("the surfaceInformationTo tool reports whether the fact was anchored", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    core.knowledge.seedBelief(npc(1), { content: "held fact", factId: "h" }, "witnessed");

    expect(cmd.surfaceInformationTo({ entity: PLAYER, fact: { content: "held fact" }, pathway: "told-by:npc:1" })).toEqual({ ok: true, surfaced: true });
    expect(cmd.surfaceInformationTo({ entity: PLAYER, fact: { content: "made up" }, pathway: "told-by:npc:1" })).toEqual({ ok: true, surfaced: false });
  });

  it("every fact the player knows traces to a recorded source event", () => {
    const core = buildEngineCore();
    core.knowledge.seedBelief(npc(1), { content: "a real secret", factId: "s" }, "witnessed");
    core.knowledge.surfaceInformationTo(PLAYER, { content: "a real secret" }, "told-by:npc:1");
    core.knowledge.recordDiaryRoom("my private plan");

    const facts = core.knowledge.knownTo(PLAYER);
    expect(facts.length).toBeGreaterThan(0);
    const ids = new Set(core.events.query().map((e) => e.id));
    for (const f of facts) {
      expect(f.sourceEventId, `fact "${f.content}" must cite a source`).toBeDefined();
      expect(ids.has(f.sourceEventId!)).toBe(true); // the cited source is a recorded event
    }
  });
});

describe("B39 — recorded interactions name only living houseguests", () => {
  it("refuses an interaction naming an evicted/unknown houseguest, accepts a living one", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    cmd.setLivingProvider(() => [npc(1), npc(2)]); // npc:1/npc:2 still in the house

    expect(() => cmd.recordInteraction({ initiator: npc(9), witnessSet: [npc(9), npc(1)], content: "x" })).toThrow();
    expect(() => cmd.recordInteraction({ initiator: npc(1), witnessSet: [npc(1), npc(3)], content: "x" })).toThrow(); // npc:3 evicted
    // A living-only interaction (and the player, always living) is accepted and folds its impact.
    expect(() => cmd.recordInteraction({ initiator: npc(1), witnessSet: [npc(1), npc(2)], content: "x", kind: "bonding" })).not.toThrow();
    expect(() => cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(2)], content: "x" })).not.toThrow();
  });

  it("a live game refuses an interaction naming a houseguest who has been evicted", () => {
    const core = buildEngineCore();
    const session = new GameSessionAdapter(core.relationships);
    session.createCharacter({ playerName: "P", seed: 2 });
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    cmd.setLivingProvider(() => session.livingIds());
    // Everyone is living at the start — naming an out-of-range id is refused.
    expect(() => cmd.recordInteraction({ initiator: npc(99), witnessSet: [npc(99)], content: "x" })).toThrow();
    expect(() => cmd.recordInteraction({ initiator: npc(1), witnessSet: [PLAYER, npc(1)], content: "x" })).not.toThrow();
  });
});
