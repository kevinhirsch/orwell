import { describe, it, expect } from "vitest";
import { foldThirdPartyConsequence } from "../../src/engine/consequence";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { RandomnessSource } from "../../src/ports/RandomnessSource";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { buildSandbox } from "../support/sandbox";
import { PLAYER, npc } from "../../src/domain/ids";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";

/**
 * Phase 1 of "the player can play offense" (layered on ADR 0005) — the THIRD-PARTY consequence
 * channel: a scene can propose "holder's opinion of a THIRD PARTY moves" (the classic "I told
 * Lorenzo that Maeve is the real threat"), not just "someone's opinion of the INITIATOR moves"
 * (the pre-existing `edges` channel). Roles only (no names — testing rule).
 *
 * Invariants under test:
 *  • I3 / Vault Wall — a holder who did NOT witness the scene is silently dropped, never minting
 *    an off-screen edge move from the player channel.
 *  • Anti-sycophancy #3 (ADR 0005) — direction/emphasis are the only inputs; the engine computes
 *    the bounded, seeded amount via a trust gate (the `campaignTilt` shape).
 *  • I2 (anti-sycophancy) — a pitch can FAIL/BACKFIRE; it is never an auto-success lever.
 *  • The SAME per-beat-per-edge anti-pump budget bounds repeated identical pitches.
 *  • Absent `aboutEdges` is byte-identical to today's path (no regression).
 *  • A boundary test proves the wiring reaches all the way through `McpServer.callTool` (the
 *    "missing #4" failure mode CLAUDE.md calls out for FE/engine write-backs).
 */

/** A fully-scripted RandomnessSource for pinning an exact roll sequence (backfire gate tests). */
class ScriptedRandom implements RandomnessSource {
  private i = 0;
  constructor(private readonly seq: readonly number[]) {}
  next(): number {
    const v = this.seq[this.i % this.seq.length]!;
    this.i++;
    return v;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
  fork(): RandomnessSource {
    return this;
  }
}

const initiator = PLAYER;
const holder = npc(1);
const about = npc(2);

describe("Phase 1 — foldThirdPartyConsequence (pure function)", () => {
  it("a witnessed pitch moves holder's opinion of `about` in the proposed direction, bounded [0,1]", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(holder, initiator).trust = 0.9; // a trusted initiator — no backfire risk
    const rng = new SeededRandom(11);
    const before = { ...rel.edge(holder, about) };

    const moved = foldThirdPartyConsequence(rel, rng, initiator, [holder], [
      { holder, about, direction: "more-threatened", emphasis: "strong" },
    ]);

    const after = rel.edge(holder, about);
    expect(moved.has(holder)).toBe(true);
    expect(after.threat).toBeGreaterThan(before.threat);
    expect(after.threat).toBeLessThanOrEqual(1); // engine-owned magnitude stays clamped
  });

  it("opposite proposed directions move the edge oppositely — the shape is the caller's, the amount is the engine's", () => {
    const run = (direction: "warmer" | "cooler") => {
      const rel = new RelationshipModel(0.5);
      rel.edge(holder, initiator).trust = 0.9;
      const rng = new SeededRandom(21);
      const before = rel.edge(holder, about).affinity;
      foldThirdPartyConsequence(rel, rng, initiator, [holder], [{ holder, about, direction, emphasis: "notable" }]);
      return rel.edge(holder, about).affinity - before;
    };
    expect(run("warmer")).toBeGreaterThan(0);
    expect(run("cooler")).toBeLessThan(0);
  });

  it("is deterministic — the same seed + inputs fold the identical magnitude", () => {
    const run = () => {
      const rel = new RelationshipModel(0.5);
      rel.edge(holder, initiator).trust = 0.9;
      const rng = new SeededRandom(99);
      foldThirdPartyConsequence(rel, rng, initiator, [holder], [
        { holder, about, direction: "warmer", emphasis: "notable" },
      ]);
      return rel.edge(holder, about);
    };
    expect(run()).toEqual(run());
  });

  it("I3 — drops the entry when `holder` was NOT a witness of the scene (never mints an off-screen read)", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(5);
    const before = { ...rel.edge(holder, about) };

    const moved = foldThirdPartyConsequence(rel, rng, initiator, [] /* holder absent */, [
      { holder, about, direction: "more-threatened", emphasis: "strong" },
    ]);

    expect(moved.size).toBe(0);
    expect(rel.edge(holder, about)).toEqual(before);
  });

  it("rejects a self-pitch, or a pitch naming the initiator on either side (that's the `edges` channel)", () => {
    const rel = new RelationshipModel(0.5);
    const rng = new SeededRandom(3);

    const moved = foldThirdPartyConsequence(rel, rng, initiator, [holder, about, initiator], [
      { holder, about: holder, direction: "warmer" }, // about === holder
      { holder: initiator, about, direction: "warmer" }, // holder === initiator
      { holder, about: initiator, direction: "warmer" }, // about === initiator
    ]);

    expect(moved.size).toBe(0);
  });

  it("I2 — can BACKFIRE: low trust in the initiator + a stronger bond with the pitch's target flips the fold onto holder->initiator", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(holder, initiator).trust = 0.05;
    rel.edge(holder, initiator).affinity = 0.05;
    rel.edge(holder, about).trust = 0.9;
    rel.edge(holder, about).affinity = 0.9;
    const beforeAbout = { ...rel.edge(holder, about) };
    const beforeInitiator = { ...rel.edge(holder, initiator) };
    // Force the backfire roll to hit (the gate is open: low trust + stronger bond with `about`).
    const rng = new ScriptedRandom([0.0, 0.5, 0.5, 0.5, 0.5]);

    const moved = foldThirdPartyConsequence(rel, rng, initiator, [holder], [
      { holder, about, direction: "more-threatened", emphasis: "strong" },
    ]);

    expect(moved.size).toBe(0); // holder->about is UNTOUCHED — the pitch backfired, not landed
    expect(rel.edge(holder, about)).toEqual(beforeAbout);
    const afterInitiator = rel.edge(holder, initiator);
    expect(afterInitiator.trust).toBeLessThan(beforeInitiator.trust); // "that felt like being worked"
    expect(afterInitiator.threat).toBeGreaterThan(beforeInitiator.threat);
  });

  it("I2 — a social move is never an auto-success: the SAME at-risk setup can also NOT backfire (roll-dependent)", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(holder, initiator).trust = 0.05;
    rel.edge(holder, initiator).affinity = 0.05;
    rel.edge(holder, about).trust = 0.9;
    rel.edge(holder, about).affinity = 0.9;
    // Force the backfire roll to MISS (same at-risk gate, but the roll clears the chance).
    const rng = new ScriptedRandom([0.99, 0.5, 0.5, 0.5, 0.5]);
    const before = rel.edge(holder, about).threat;

    const moved = foldThirdPartyConsequence(rel, rng, initiator, [holder], [
      { holder, about, direction: "more-threatened", emphasis: "strong" },
    ]);

    expect(moved.has(holder)).toBe(true); // this time it landed — the risk was real, not certain either way
    expect(rel.edge(holder, about).threat).toBeGreaterThan(before);
  });

  it("even a barely-trusted pitch lands SOME amount (the trustFloor) — never a zero-effect no-op", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(holder, initiator).trust = 0; // as untrusted as it gets
    // Force the roll high so the backfire gate (open here) still doesn't fire — isolating the floor.
    const rng = new ScriptedRandom([0.99, 0.5, 0.5, 0.5, 0.5]);
    const before = rel.edge(holder, about).affinity;

    foldThirdPartyConsequence(rel, rng, initiator, [holder], [
      { holder, about, direction: "warmer", emphasis: "notable" },
    ]);

    expect(rel.edge(holder, about).affinity).toBeGreaterThan(before);
  });

  it("honors the caller's spend budget — a refused spend drops the entry with no fold", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(holder, initiator).trust = 0.9;
    const rng = new SeededRandom(4);
    const before = { ...rel.edge(holder, about) };

    const moved = foldThirdPartyConsequence(rel, rng, initiator, [holder], [
      { holder, about, direction: "more-threatened" },
    ], () => false); // budget exhausted

    expect(moved.size).toBe(0);
    expect(rel.edge(holder, about)).toEqual(before);
  });
});

describe("Phase 1 — EngineCommandsAdapter.recordInteraction wiring", () => {
  function build() {
    const rel = new RelationshipModel(0.5);
    const events = new InMemoryEventStore();
    const knowledge = new InMemoryKnowledgeService(events);
    const rng = new SeededRandom(77);
    const commands = new EngineCommandsAdapter(events, knowledge, rel, rng);
    return { commands, rel, events };
  }

  it("folds a witnessed aboutEdges pitch through the live recordInteraction seam", () => {
    const { commands, rel } = build();
    rel.edge(holder, initiator).trust = 0.9;
    const before = { ...rel.edge(holder, about) };

    const { eventId } = commands.recordInteraction({
      initiator, witnessSet: [initiator, holder],
      content: "You pulled them aside and made the case that the other one is the real threat.",
      consequence: { aboutEdges: [{ holder, about, direction: "more-threatened", emphasis: "strong" }] },
    });

    expect(eventId).toBeTruthy();
    expect(rel.edge(holder, about).threat).toBeGreaterThan(before.threat);
  });

  it("drops an aboutEdges entry naming a holder outside this scene's witness set", () => {
    const { commands, rel } = build();
    const before = { ...rel.edge(holder, about) };

    commands.recordInteraction({
      initiator, witnessSet: [initiator], // holder is NOT here
      content: "You considered floating it to them, but they were nowhere near this conversation.",
      consequence: { aboutEdges: [{ holder, about, direction: "more-threatened" }] },
    });

    expect(rel.edge(holder, about)).toEqual(before);
  });

  it("absent aboutEdges is BYTE-IDENTICAL to today's kind-only path (no regression)", () => {
    const a = build();
    const b = build();
    a.commands.recordInteraction({ initiator, witnessSet: [initiator, holder], content: "an ordinary chat", kind: "strategy" });
    b.commands.recordInteraction({
      initiator, witnessSet: [initiator, holder], content: "an ordinary chat", kind: "strategy",
      consequence: { aboutEdges: [] }, // present but empty ⇒ must behave exactly as absent
    });
    expect(b.rel.edge(holder, initiator)).toEqual(a.rel.edge(holder, initiator));
  });

  it("rides the SAME per-beat-per-edge anti-pump budget — repeated identical pitches still bound the total swing", () => {
    const { commands, rel } = build();
    rel.edge(holder, initiator).trust = 0.9; // no backfire risk — isolate the budget behavior
    const pitch = { initiator, witnessSet: [initiator, holder], consequence: {
      aboutEdges: [{ holder, about, direction: "more-threatened" as const, emphasis: "strong" as const }],
    } };
    for (let i = 0; i < 5; i++) {
      commands.recordInteraction({ ...pitch, content: `pitch attempt ${i}` });
    }
    const capped = rel.edge(holder, about).threat;

    // The SAME rng stream run through exactly 3 unbounded direct folds (MAX_FOLDS_PER_PAIR_PER_BEAT)
    // must land on the identical magnitude — proving the cap, not chance, is what stopped it.
    const rel3 = new RelationshipModel(0.5);
    rel3.edge(holder, initiator).trust = 0.9;
    const rng3 = new SeededRandom(77);
    for (let i = 0; i < 3; i++) {
      foldThirdPartyConsequence(rel3, rng3, initiator, [holder], [{ holder, about, direction: "more-threatened", emphasis: "strong" }]);
    }
    expect(capped).toBeCloseTo(rel3.edge(holder, about).threat, 9);

    // ...and it is strictly LESS than what 5 unbounded folds on the same stream would have produced.
    const rel5 = new RelationshipModel(0.5);
    rel5.edge(holder, initiator).trust = 0.9;
    const rng5 = new SeededRandom(77);
    for (let i = 0; i < 5; i++) {
      foldThirdPartyConsequence(rel5, rng5, initiator, [holder], [{ holder, about, direction: "more-threatened", emphasis: "strong" }]);
    }
    expect(capped).toBeLessThan(rel5.edge(holder, about).threat);
  });
});

describe("Phase 1 boundary — recordInteraction's aboutEdges reaches the engine over the MCP boundary", () => {
  // The recurring "missing #4" failure mode (CLAUDE.md): a write-back can typecheck and pass every
  // unit test while being DEAD at runtime if the McpServer dispatch/shape-guard wiring is incomplete.
  // This dispatches the REAL tool name through the REAL McpServer, exactly like a live MCP client would.
  function playerServer() {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge, sb.engine.relationships);
    const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
    return { server, rel: sb.engine.relationships };
  }

  it("dispatches recordInteraction with consequence.aboutEdges and folds it (not rejected, not a no-op)", async () => {
    const { server, rel } = playerServer();
    // Fresh sandbox edges sit at baseline (equal bonds either side) — the backfire gate needs a
    // STRICTLY stronger bond with `about`, so a fresh pair never backfires: a deterministic pass.
    const before = { ...rel.edge(npc(1), npc(2)) };

    const res = (await server.callTool("recordInteraction", {
      initiator: PLAYER, witnessSet: [PLAYER, npc(1)],
      content: "You told them the other one is coming for them next.",
      consequence: { aboutEdges: [{ holder: npc(1), about: npc(2), direction: "more-threatened", emphasis: "strong" }] },
    })) as { eventId: string };

    expect(res.eventId).toBeTruthy();
    expect(rel.edge(npc(1), npc(2)).threat).toBeGreaterThan(before.threat);
  });

  it("drops an aboutEdges entry naming a holder who was not in the witness set, even over the MCP boundary", async () => {
    const { server, rel } = playerServer();
    const before = { ...rel.edge(npc(3), npc(4)) };

    await server.callTool("recordInteraction", {
      initiator: PLAYER, witnessSet: [PLAYER], // npc:3 never appears in this scene
      content: "You thought about floating something about npc:4, but npc:3 wasn't even in the room.",
      consequence: { aboutEdges: [{ holder: npc(3), about: npc(4), direction: "more-threatened" }] },
    });

    expect(rel.edge(npc(3), npc(4))).toEqual(before);
  });

  it("the recordInteraction tool's description teaches the new aboutEdges capability", () => {
    // A cheap drift guard: the model-facing description must actually mention the new shape
    // (mirrors how confide/exposeSecret spell out exactly when/how to use their levers).
    const tool = PLAYER_TOOLS.find((t) => t.name === "recordInteraction");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("aboutEdges");
    expect(tool!.description.toLowerCase()).toContain("third-party");
  });
});
