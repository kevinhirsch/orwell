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

  it("a teller who WITNESSED an event may surface it; overheard requires a real event AND derived content", () => {
    const core = buildEngineCore();
    core.events.record({ id: "scene:1", ts: 1, type: "conversation", initiator: npc(2), witnessSet: [npc(2), npc(3)], hidden: true, content: "they schemed about the vote tonight" });

    // npc:2 witnessed the scene → may legitimately tell it (verbatim or a real fragment).
    expect(core.knowledge.surfaceInformationTo(PLAYER, { content: "they schemed about the vote tonight" }, "told-by:npc:2")).not.toBeNull();
    // overheard: a real event id + a genuine fragment of ITS content (the engine's overhear shape) → anchored.
    expect(core.knowledge.surfaceInformationTo(PLAYER, { content: "(overheard, muffled) they schemed about…" }, "overheard:scene:1")).not.toBeNull();
    // a non-existent event id → suspicion.
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

    expect(() => cmd.recordInteraction({ initiator: npc(9), witnessSet: [npc(9), npc(1), PLAYER], content: "x" })).toThrow();
    expect(() => cmd.recordInteraction({ initiator: npc(1), witnessSet: [npc(1), npc(3), PLAYER], content: "x" })).toThrow(); // npc:3 evicted
    // A living-only, player-witnessed interaction (E21) is accepted and folds its impact.
    expect(() => cmd.recordInteraction({ initiator: npc(1), witnessSet: [npc(1), npc(2), PLAYER], content: "x", kind: "bonding" })).not.toThrow();
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

/**
 * Audit E9 + C2 + C3 — content-LINEAGE anchoring. The old anchor passed on "the teller knows
 * something about the same subject" (C2) or "any event with that id exists" (E9/C3), so one real
 * id or one real belief laundered ARBITRARY invented content into full-confidence player
 * knowledge with clean provenance. Now the claim must derive from the actual source content.
 */
describe("E9/C2/C3 — anchoring requires content lineage, not just a real-looking source", () => {
  it("told-by: a subject-only match no longer anchors — invented content about a known subject is a suspicion", () => {
    const core = buildEngineCore();
    // The teller genuinely knows SOMETHING about npc:9 — a harmless domestic fact.
    core.knowledge.seedBelief(npc(1), { content: "likes to cook breakfast", factId: "bk", subject: npc(9) }, "witnessed");

    // The C2 exploit verbatim: same subject, fabricated claim. Must NOT become knowledge.
    const invented = core.knowledge.surfaceInformationTo(
      PLAYER,
      { content: "has a final-two deal against you and is throwing comps", subject: npc(9) },
      "told-by:npc:1",
    );
    expect(invented).toBeNull();
    expect(core.knowledge.knownTo(PLAYER)).toHaveLength(0);
    const s = core.knowledge.suspicionsOf(PLAYER);
    expect(s).toHaveLength(1); // downgraded, traceably, to a hunch
  });

  it("told-by: a real fragment of what the teller holds (incl. its undistorted origin) still anchors", () => {
    const core = buildEngineCore();
    core.knowledge.seedBelief(
      npc(1),
      { content: "word is two houseguests are plotting something · or so I heard#7", originalContent: "word is two houseguests are plotting something", factId: "r" },
      "told-by:npc:2",
    );
    // The narrator retells the drifted belief minus the drift suffix — derived content, anchored.
    expect(core.knowledge.surfaceInformationTo(PLAYER, { content: "word is two houseguests are plotting something" }, "told-by:npc:1")).not.toBeNull();
    // Padding the real belief with extra invented claims is NOT derivation — downgraded.
    expect(
      core.knowledge.surfaceInformationTo(
        PLAYER,
        { content: "word is two houseguests are plotting something and they want you out next" },
        "told-by:npc:1",
      ),
    ).toBeNull();
  });

  it("overheard: a real event id can no longer anchor unrelated invented content (the C3 execution case)", () => {
    const core = buildEngineCore();
    core.events.record({
      id: "scene:real", ts: 1, type: "conversation", initiator: npc(1),
      witnessSet: [npc(1), npc(2)], hidden: true, content: "a quiet chat about laundry duty",
    });
    // A totally fabricated secret pinned to a real, unrelated event id ⇒ suspicion only.
    const got = core.knowledge.surfaceInformationTo(PLAYER, { content: "a totally fabricated secret" }, "overheard:scene:real");
    expect(got).toBeNull();
    expect(core.knowledge.knownTo(PLAYER)).toHaveLength(0);
    expect(core.knowledge.suspicionsOf(PLAYER).some((x) => x.content === "a totally fabricated secret")).toBe(true);
    // …while the engine's own overhear shape (a strict fragment of THAT event) anchors.
    expect(core.knowledge.surfaceInformationTo(PLAYER, { content: "(overheard, muffled) a quiet chat about…" }, "overheard:scene:real")).not.toBeNull();
  });

  it("anchored knowledge is by construction a fragment of something real", () => {
    const core = buildEngineCore();
    core.events.record({
      id: "scene:f", ts: 1, type: "conversation", initiator: npc(1),
      witnessSet: [npc(1), npc(2)], hidden: true, content: "they planned the week's votes in the storage room",
    });
    core.knowledge.seedBelief(npc(2), { content: "they planned the week's votes in the storage room", factId: "v" }, "witnessed");
    for (const pathway of ["overheard:scene:f", "told-by:npc:2"]) {
      const fact = core.knowledge.surfaceInformationTo(PLAYER, { content: "planned the week's votes" }, pathway);
      expect(fact).not.toBeNull();
      expect("they planned the week's votes in the storage room".includes(fact!.content)).toBe(true);
    }
  });
});

/** Audit C14 — knowledge/suspicion confidence is clamped to [0,1] at every write seam. */
describe("C14 — confidence is clamped wherever it enters or accumulates", () => {
  const inRange = (c: number | undefined): void => {
    expect(c).toBeDefined();
    expect(c!).toBeGreaterThanOrEqual(0);
    expect(c!).toBeLessThanOrEqual(1);
  };

  it("a caller-supplied confidence of 50 or −3 never persists on a surfaced fact", () => {
    const core = buildEngineCore();
    core.events.record({ id: "s:1", ts: 1, type: "conversation", initiator: npc(1), witnessSet: [npc(1)], hidden: true, content: "a long whispered plan about jury votes" });
    const hi = core.knowledge.surfaceInformationTo(npc(2), { content: "whispered plan about jury", confidence: 50 }, "overheard:s:1");
    inRange(hi!.confidence);
    expect(hi!.confidence).toBe(1);
    const lo = core.knowledge.surfaceInformationTo(npc(3), { content: "whispered plan about jury", confidence: -3 }, "overheard:s:1");
    inRange(lo!.confidence);
    expect(lo!.confidence).toBe(0);
  });

  it("seeded and gossip-transmitted beliefs clamp too — the decay math can never start out of range", () => {
    const core = buildEngineCore();
    const seeded = core.knowledge.seedBelief(npc(1), { content: "a rumor", factId: "g", confidence: 99 }, "origin");
    inRange(seeded.confidence);
    const passed = core.knowledge.transmitGossip(npc(1), npc(2), { content: "a rumor · roughly#1", originalContent: "a rumor", factId: "g", confidence: -0.5, hops: 1 }, "told-by:npc:1");
    inRange(passed.confidence);
  });

  it("a suspicion's confidence is clamped AND capped below knowledge-grade", () => {
    const core = buildEngineCore();
    const s = core.knowledge.addSuspicion(PLAYER, { content: "someone is lying", confidence: 50 });
    inRange(s.confidence);
    expect(s.confidence!).toBeLessThanOrEqual(0.5); // a hunch is never near-certain (C2)
    // The downgrade path (an unanchored surfacing) caps the carried confidence the same way.
    core.knowledge.surfaceInformationTo(PLAYER, { content: "an invented bombshell", confidence: 1 }, "told-by:npc:1");
    const down = core.knowledge.suspicionsOf(PLAYER).find((x) => x.content === "an invented bombshell");
    expect(down).toBeDefined();
    expect(down!.confidence ?? 0).toBeLessThanOrEqual(0.5);
  });
});
