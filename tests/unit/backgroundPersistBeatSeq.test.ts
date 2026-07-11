import { describe, it, expect } from "vitest";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { Orchestrator } from "../../src/composition/orchestrator";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { UserSandbox } from "../../src/composition/registry";
import { PLAYER, npc } from "../../src/domain/ids";

// R-BND-1 / R-BND-2 (#628) — the background-write-back beatSeq invariant, pinned as a boundary gate
// (the fix-ledger's ENG-5 / CONS-2-hardening ask).
//
// The FE-driven, fail-soft enrichment write-backs (0070 `recordOffscreenSceneTexture`, 0062
// `recordWorldSnapshot`) change PROSE, not the board. They must persist DURABLY but must NOT bump the
// closed-set `beatSeq`: a background bump would make the engine's own enrichment task look like a
// concurrent board mutation to the FE's CAS layer and trip a phantom single-tab stale-409 (the A-S3
// fold-drop — a player scene's only consequence fold reconciled-and-skipped). The correct channel is
// the registry's `setOnBackgroundPersist` seam (syncAdmin + invalidateSnapshot + blind save — never
// `commit`). These tests drive the REAL registry-wired sandbox through the REAL MCP boundary, so a
// regression that reroutes either tool back through the commit funnel (or forgets to wire the
// background seam, which falls back to `onPersist` = commit) fails here deterministically. Roles only.

function wiredSandbox(user: string, seed: number): { sb: UserSandbox; server: McpServer; orch: Orchestrator; reg: GameSessionRegistry } {
  const reg = new GameSessionRegistry();
  const orch = new Orchestrator(reg, { now: () => seed }, { seed });
  const sb = reg.sandboxFor(user); // registry-wired: onPersist=commit(bump), onBackgroundPersist=blind save
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { sb, server: sb.mcp.player, orch, reg };
}

describe("R-BND (#628) — background write-backs persist durably WITHOUT bumping beatSeq", () => {
  it("sanity: a genuine committed mutation DOES bump beatSeq in this same harness (the counter is live)", () => {
    const { sb } = wiredSandbox("bg-bump-sanity", 9101);
    const before = sb.session.gameStatus().beatSeq;
    // A recorded player scene is ONE committed mutation through the single funnel (0065 Part A).
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "scene" });
    expect(sb.session.gameStatus().beatSeq).toBe(before + 1);
  });

  it("R-BND-1: recordOffscreenSceneTexture (0070) leaves beatSeq unchanged and persists the texture", async () => {
    const { sb, server, orch } = wiredSandbox("bg-texture", 9102);
    // Generate off-screen skeletons (up to a few ticks — a tick may yield none in edge phases).
    let skeletons: { eventId: string }[] = [];
    for (let i = 0; i < 4 && skeletons.length === 0; i++) {
      orch.advance("bg-texture", "offscreen-tick");
      skeletons = (await server.callTool("getOffscreenSceneSkeletons", {})) as { eventId: string }[];
    }
    expect(skeletons.length).toBeGreaterThan(0); // seeds above are known-good; roles only
    const before = sb.session.gameStatus().beatSeq;

    const res = (await server.callTool("recordOffscreenSceneTexture", {
      eventId: skeletons[0]!.eventId,
      content: "R-BND-1 texture write-back",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);

    // The closed-set counter did not move — a background prose enrichment is NOT a board beat.
    expect(sb.session.gameStatus().beatSeq).toBe(before);
    // But the write is DURABLE: it landed in the persisted snapshot (blind save, not dropped).
    const snap = sb.session.snapshot();
    expect(snap.textureOverrides?.[skeletons[0]!.eventId]).toBeDefined();
    expect(snap.beatSeq).toBe(before); // the persisted counter matches the live one — no hidden bump
  });

  it("R-BND-2: recordWorldSnapshot (0062 zeitgeist) leaves beatSeq unchanged and freezes the capture", async () => {
    const { sb, server } = wiredSandbox("bg-zeitgeist", 9103);
    const before = sb.session.gameStatus().beatSeq;

    const res = (await server.callTool("recordWorldSnapshot", {
      slices: { news: ["a headline the house half-remembers"], mood: "restless" },
    })) as { accepted: boolean; source: string };
    expect(res.accepted).toBe(true);
    expect(res.source).toBe("web_search");

    // No closed-set movement…
    expect(sb.session.gameStatus().beatSeq).toBe(before);
    // …but the capture is durably frozen onto the season (non-degradation: persisted, not pending).
    const snap = sb.session.snapshot();
    expect(snap.worldSnapshot?.source).toBe("web_search");
    expect(snap.beatSeq).toBe(before);
  });

  it("the background persist survives a save/restore round-trip (durable, not a lost write)", async () => {
    const user = "bg-roundtrip";
    const { sb, server } = wiredSandbox(user, 9104);
    const before = sb.session.gameStatus().beatSeq;
    await server.callTool("recordWorldSnapshot", { slices: { mood: "electric" } });
    expect(sb.session.gameStatus().beatSeq).toBe(before);

    // Restore the persisted snapshot into a FRESH session: the enrichment is there, at the same beatSeq.
    const snap = sb.session.snapshot();
    const reg2 = new GameSessionRegistry();
    const sb2 = reg2.sandboxFor(user);
    sb2.session.restore(snap);
    expect(sb2.session.snapshot().worldSnapshot?.slices.mood).toBe("electric");
    expect(sb2.session.gameStatus().beatSeq).toBe(before);
  });
});
