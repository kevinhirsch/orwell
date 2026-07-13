import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime } from "../../src/composition/runtime";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";

/**
 * The 2026-07-13 prod deadlock — the PRE-GAME (prewarm) cast-authoring write-back must land WITHOUT a
 * degradation refusal when the FULL runtime (orchestrator commit spine) is wired.
 *
 * The 0116 skeleton-first flow authors the deep profiles DURING the casting interview, onto the
 * `preSeedCast` warm (`recordCastProfile` pre-create). That fold RE-SEALS the subject's Vault records,
 * REPLACING the seeded floor's derived story threads — and an authored profile with FEWER secrets than
 * the floor derives fewer `thread:<id>:<n>` records, so `thread:` Vault ids vanish against the
 * post-genesis baseline. Routed through the CHECKPOINTED player-turn commit (the old prewarm-path
 * `persist()`), that read as a DETERMINISTIC `TurnRefusedError (degradation)` on EVERY pre-create
 * write-back: authoring could never land, the #1313 house-entry hold starved forever (the player's
 * casting chat went silent), and the repeated faults opened the corruption circuit. The standalone
 * boundary tests (`castGenesisBoundary` / `castPrewarm`) never saw it — no orchestrator wired.
 *
 * The fix routes the prewarm fold through the SAME background-persist seam the live fold uses
 * (#1067/R-BND: blind durable save + `seedBaseline` re-seed — an FE-driven enrichment is not a player
 * turn). These tests drive the REAL runtime + the MCP boundary (the per-user resolver, exactly the
 * HTTP path), per the four-place-rule discipline. Roles only — synthetic military-phonetic fixture
 * names, never a corpus/legacy cast.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-prewarm-author-"));

function liveRuntime(dir = freshDir()) {
  return composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() });
}

const NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India",
  "Juliet", "Kilo", "Lima", "Mike", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform"];
const synthName = (i: number): string => `${NATO[i % NATO.length]} ${NATO[(i + 11) % NATO.length]}`;

/** A full, envelope-clean 15-NPC genesis proposal off the warmed roster ids (the 0116 skeleton). */
function fullProposal(ids: string[]): Record<string, unknown> {
  return {
    npcs: ids.map((id, i) => ({
      id,
      name: synthName(i),
      identity: `a distinct model-authored houseguest, slot ${i}`,
      biography: `An authored genesis biography for slot ${i} — a real backstory with texture and history.`,
      stats: { physical: 0.3 + ((i * 7) % 55) / 100, mental: 0.9 - ((i * 5) % 60) / 100, social: 0.35 + ((i * 11) % 50) / 100 },
      hiddenElements: [
        { kind: "divergent-persona", detail: `wears a mask, slot ${i}` },
        { kind: "pre-game-tie", detail: `a quiet pre-show pact, slot ${i}` },
        { kind: "secret-motive", detail: `a private reason to win, slot ${i}` },
      ],
    })),
    ties: [{ a: ids[0], b: ids[1], nature: "casting-callback" }],
  };
}

// A THIN authored profile — deliberately FEWER secrets than the seeded floor, so the re-derived
// story threads shrink and the Vault re-seal replaces more records than it re-mints (the prod shape).
const THIN_PROFILE = {
  biography:
    "Outside the house they run a beloved neighborhood bakery they built from a single market stall over "
    + "a decade of dawn shifts. They learned to read a room from years behind the counter.",
  secrets: ["carries a quiet debt no one knows about"],
  trueGoals: ["reach the end without a target on their back"],
  weakness: "loyal to a fault, slow to cut a friend",
};

describe("prod deadlock 2026-07-13 — pre-game authoring lands under the orchestrator", () => {
  it("the 0116 flow (preSeedCast → genesis → thin recordCastProfile) is NOT refused, via the MCP boundary", async () => {
    const runtime = liveRuntime();
    const server = runtime.registry.resolver()("player", "u");

    const warm = (await server.callTool("preSeedCast", { seed: 5 })) as { warmed: boolean; house: { id: string }[] };
    expect(warm.warmed).toBe(true);
    const ids = warm.house.map((h) => h.id);

    const genesis = (await server.callTool("recordCastGenesis", fullProposal(ids))) as { accepted: boolean };
    expect(genesis.accepted).toBe(true);

    // The wedge: EVERY pre-create authoring write-back used to throw
    // `TurnRefusedError: turn refused — integrity checkpoint failed (degradation)`.
    for (const id of ids.slice(0, 3)) {
      const res = (await server.callTool("recordCastProfile", { houseguestId: id, ...THIN_PROFILE })) as {
        accepted: boolean;
      };
      expect(res.accepted).toBe(true);
    }

    // No integrity faults were recorded and the corruption circuit never opened.
    const health = runtime.orchestrator.sandboxHealth("u") as {
      lastIntegrity: string; faults: unknown[]; circuitOpen: boolean;
    };
    expect(health.faults).toEqual([]);
    expect(health.circuitOpen).toBe(false);
  });

  it("the authored prewarm survives onto the live roster and the season commits cleanly", async () => {
    const runtime = liveRuntime();
    const server = runtime.registry.resolver()("player", "u");

    const warm = (await server.callTool("preSeedCast", { seed: 9 })) as { house: { id: string }[] };
    const ids = warm.house.map((h) => h.id);
    await server.callTool("recordCastGenesis", fullProposal(ids));
    await server.callTool("recordCastProfile", { houseguestId: ids[0], ...THIN_PROFILE });

    // Finalize casting — adopts the warmed, genesis+deep-authored cast (a checkpointed commit).
    const view = (await server.callTool("createCharacter", {
      playerName: "The Player", backstory: "a backstory", motivation: "a motivation",
    })) as { started: boolean; week: number; phase: string };
    expect(view.started).toBe(true);
    expect(view.week).toBe(1);
    expect(view.phase).toBe("premiere");

    // The deep-authored biography crossed onto the live roster via the adopt.
    const sb = runtime.registry.sandboxFor("u");
    const npc = sb.session.snapshot().house!.npcs.find((n) => n.id === ids[0])!;
    expect(npc.character.biography).toBe(THIN_PROFILE.biography);

    // A subsequent genuine player-turn commit is not refused (the baseline was re-seeded correctly).
    runtime.registry.invalidateSnapshot("u");
    expect(() => runtime.orchestrator.commitPlayerTurn("u")).not.toThrow();
    const health = runtime.orchestrator.sandboxHealth("u") as { lastIntegrity: string; faults: unknown[] };
    expect(health.lastIntegrity).toBe("ok");
    expect(health.faults).toEqual([]);
  });

  it("the pre-0116 prewarm flow (no genesis) with a thin authored profile also lands (the latent shape)", async () => {
    const runtime = liveRuntime();
    const server = runtime.registry.resolver()("player", "u");

    const warm = (await server.callTool("preSeedCast", { seed: 11 })) as { house: { id: string }[] };
    const ids = warm.house.map((h) => h.id);
    // No genesis — straight to a thin deep-author over the seeded floor (the same Vault-id shrink).
    for (const id of ids.slice(0, 2)) {
      const res = (await server.callTool("recordCastProfile", { houseguestId: id, ...THIN_PROFILE })) as {
        accepted: boolean;
      };
      expect(res.accepted).toBe(true);
    }
    const health = runtime.orchestrator.sandboxHealth("u") as { faults: unknown[]; circuitOpen: boolean };
    expect(health.faults).toEqual([]);
    expect(health.circuitOpen).toBe(false);
  });

  it("the pre-game write-back persists DURABLY (a restart resumes the authored prewarm)", async () => {
    const dir = freshDir();
    const runtime = liveRuntime(dir);
    const server = runtime.registry.resolver()("player", "u");
    const warm = (await server.callTool("preSeedCast", { seed: 7 })) as { house: { id: string }[] };
    const ids = warm.house.map((h) => h.id);
    await server.callTool("recordCastGenesis", fullProposal(ids));
    await server.callTool("recordCastProfile", { houseguestId: ids[0], ...THIN_PROFILE });

    // A fresh runtime over the same save dir (an engine restart mid-casting) resumes the authored warm.
    const resumed = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() });
    const view = (await resumed.registry.resolver()("player", "u").callTool("createCharacter", {
      playerName: "The Player", backstory: "a backstory", motivation: "a motivation",
    })) as { started: boolean };
    expect(view.started).toBe(true);
    const npc = resumed.registry.sandboxFor("u").session.snapshot().house!.npcs.find((n) => n.id === ids[0])!;
    expect(npc.character.biography).toBe(THIN_PROFILE.biography);
  });
});
