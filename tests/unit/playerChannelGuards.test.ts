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
    expect(core.events.queryAll()).toHaveLength(0); // nothing recorded, hidden or otherwise
  });

  it("the player initiating IS being in the scene: their seat is made explicit and the event is never hidden", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    const { eventId } = cmd.recordInteraction({ initiator: PLAYER, witnessSet: [npc(1)], content: "a hallway aside" });
    const ev = core.events.queryAll().find((e) => e.id === eventId)!;
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
      id: `season:${core.events.queryAll().length}`, ts: core.events.queryAll().length,
      type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "a ceremony resolves",
    });
    // … and the SAME interaction folds again: a new beat, a fresh budget.
    cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "chat", kind: "bonding" });
    expect(JSON.stringify(core.relationships.serialize())).not.toBe(spent);
  });
});

/**
 * R3 (0065 Part E latency tail) — `currentBeatKey` (the fold-budget beat window) is consulted on EVERY
 * `recordInteraction`. It used to scan the WHOLE append-only log backward for the latest `season:` beat —
 * between beats it walked every accumulated interaction/gossip/confessional event, so the per-call work
 * grew with season length (the deferred R3 latency tail). It is now INCREMENTAL: keyed on the O(1) event
 * count, it scans only the TAIL appended since its last call (`eventsSince` — O(Δ)). The latest `season:`
 * id is monotonic under the append-only contract, so the cache can never go stale. These tests pin BOTH
 * the O(Δ) complexity AND byte-for-byte equivalence with the old whole-log backward scan.
 * HARD rule: roles only — no names.
 */
describe("R3 — currentBeatKey is O(Δ), not O(events) (the Part E latency tail)", () => {
  /** The old whole-log backward scan (the reference implementation `currentBeatKey` must equal). */
  const oldScan = (events: ReturnType<typeof buildEngineCore>["events"]): string => {
    const evs = events.queryAll();
    for (let i = evs.length - 1; i >= 0; i--) if (evs[i]!.id.startsWith("season:")) return evs[i]!.id;
    return "pre-season";
  };

  it("per-recordInteraction tail scan is bounded by Δ, regardless of how long the season is", () => {
    const measure = (warmup: number): { total: number; scanned: number } => {
      const core = buildEngineCore();
      const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
      // A long stretch of interactions with NO new `season:` beat — the worst case the old scan walked
      // the whole log on every call (the latest beat is far behind a growing tail of conversation events).
      // `kind` makes each call consult the beat window (rollBeatWindow → currentBeatKey), the hot path.
      for (let i = 0; i < warmup; i++) {
        cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: `chat ${i}`, kind: "bonding" });
      }
      const total = core.events.count();
      // Instrument the O(Δ) tail provider and take ONE more recorded interaction.
      let scanned = 0;
      const orig = core.events.eventsSince.bind(core.events);
      core.events.eventsSince = (from: number): ReturnType<typeof orig> => {
        const out = orig(from);
        scanned += out.length;
        return out;
      };
      cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "final", kind: "bonding" });
      return { total, scanned };
    };
    const small = measure(8);
    const large = measure(160); // ~10× the events
    expect(large.total).toBeGreaterThan(small.total * 3); // a genuinely longer season
    // The tail scanned per call is a small constant — NEVER the whole, ever-growing log.
    expect(large.scanned).toBeLessThanOrEqual(8);
    expect(large.scanned).toBe(small.scanned); // identical work whether 8 or 160 interactions precede it
    expect(large.scanned).toBeLessThan(large.total); // categorically sub-linear in history
  });

  it("is byte-for-byte equivalent to the old whole-log backward scan across beats + interactions", () => {
    const core = buildEngineCore();
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    // `foldBeatKey` mirrors `currentBeatKey()` after every `recordInteraction` (rollBeatWindow sets it),
    // so it is the observable proxy for the private key. Drive a realistic mix: interactions, then a
    // beat, more interactions, another beat — re-checking equivalence at each step.
    const expectKeyMatches = (): void => {
      // `kind` makes recordInteraction consult the beat window (rollBeatWindow → currentBeatKey).
      cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "x", kind: "bonding" });
      expect((cmd as unknown as { foldBeatKey: string }).foldBeatKey).toBe(oldScan(core.events));
    };
    expectKeyMatches(); // pre-season window (no beat yet)
    for (let i = 0; i < 5; i++) expectKeyMatches();
    core.events.record({ id: `season:${core.events.count()}`, ts: core.events.count(), type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "beat A" });
    expectKeyMatches(); // window advanced to beat A
    for (let i = 0; i < 5; i++) expectKeyMatches();
    core.events.record({ id: `season:${core.events.count()}`, ts: core.events.count(), type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "beat B" });
    for (let i = 0; i < 5; i++) expectKeyMatches(); // window advanced to beat B
  });

  it("a fresh adapter built over an already-populated (resumed) log finds the latest beat on first call", () => {
    // The 0030 resume path: a new sandbox's adapter is built over an event store that restoreRecord then
    // fills. The first currentBeatKey call (cache empty) scans the full restored tail once — and must land
    // on the SAME latest beat the old whole-log scan would, never a stale "pre-season".
    const core = buildEngineCore();
    for (let i = 0; i < 30; i++) core.events.restoreRecord({ id: `evt:${i}`, ts: i, type: "conversation", initiator: PLAYER, witnessSet: [PLAYER, npc(1)], hidden: false, content: `c${i}` });
    core.events.restoreRecord({ id: "season:LATEST", ts: 100, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "the latest beat" });
    for (let i = 0; i < 30; i++) core.events.restoreRecord({ id: `evt:b${i}`, ts: 200 + i, type: "conversation", initiator: PLAYER, witnessSet: [PLAYER, npc(1)], hidden: false, content: `d${i}` });
    const cmd = new EngineCommandsAdapter(core.events, core.knowledge, core.relationships);
    cmd.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "after resume", kind: "bonding" });
    expect((cmd as unknown as { foldBeatKey: string }).foldBeatKey).toBe("season:LATEST");
    expect((cmd as unknown as { foldBeatKey: string }).foldBeatKey).toBe(oldScan(core.events));
  });
});
