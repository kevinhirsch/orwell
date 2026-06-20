import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { PLAYER_TOOLS } from "../../src/surfaces/tools/registry";
import { buildSandbox } from "../support/sandbox";

// Feature 0065 — cast pre-warm: deep-author the cast BEFORE portraits, off the season seed, before the
// player's name exists. Roles only (no names from any corpus); the warmed roster is engine ids + facets.

describe("0065 — the authoring write-back + pre-warm reach the engine over the MCP boundary", () => {
  function playerServer(): McpServer {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    return new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  }

  it("preSeedCast and recordCastProfile are on the player channel (the boundary bug)", () => {
    const names = PLAYER_TOOLS.map((t) => t.name);
    expect(names).toContain("preSeedCast");
    expect(names).toContain("recordCastProfile");
  });

  it("dispatches preSeedCast then recordCastProfile — neither is rejected as 'not available'", async () => {
    const server = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 5 })) as { warmed: boolean; house: { id: string }[] };
    expect(warm.warmed).toBe(true);
    expect(warm.house.length).toBeGreaterThan(0);
    const res = (await server.callTool("recordCastProfile", {
      houseguestId: warm.house[0]!.id, biography: "A real two-sentence backstory. It has presentable parts.",
    })) as { accepted: boolean };
    expect(res.accepted).toBe(true);
  });
});

describe("0065 — preSeedCast warms the player-independent cast", () => {
  it("is deterministic + player-independent (same seed ⇒ same warmed cast)", () => {
    const a = new GameSessionAdapter().preSeedCast({ seed: 77 });
    const b = new GameSessionAdapter().preSeedCast({ seed: 77 });
    expect(a.warmed).toBe(true);
    expect(a.house.map((h) => h.name)).toEqual(b.house.map((h) => h.name));
    expect(a.house.map((h) => h.biography)).toEqual(b.house.map((h) => h.biography));
    expect(a.seed).toBe(77);
  });

  it("warms the 15 NPCs only (the player has their own headshot) with portrait prompts", () => {
    const warm = new GameSessionAdapter().preSeedCast({ seed: 12 });
    expect(warm.house.length).toBe(15);
    expect(warm.portraitPrompts.length).toBe(15);
    // Every warmed card carries the PUBLIC biography facet the deep layer folds — the store is "deep".
    expect(warm.house.every((h) => typeof h.biography === "string" && h.biography!.length > 0)).toBe(true);
  });

  it("is idempotent — a re-warm returns the already-warmed cast, never restarts mid-flight", () => {
    const s = new GameSessionAdapter();
    const w1 = s.preSeedCast({ seed: 3 });
    const w2 = s.preSeedCast({});
    expect(w2.alreadyWarmed).toBe(true);
    expect(w2.seed).toBe(w1.seed);
    expect(w2.house.map((h) => h.name)).toEqual(w1.house.map((h) => h.name));
  });

  it("refuses honestly once a season is running (casting is closed)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 5 });
    const warm = s.preSeedCast({ seed: 6 });
    expect(warm.warmed).toBe(false);
    expect(warm.refused).toBe("in-progress");
  });
});

describe("0065 — createCharacter ADOPTS the warmed (and authored) cast", () => {
  it("the authored biography survives onto the live house when the seed matches (or is omitted)", () => {
    for (const finalize of [{ playerName: "The Player", seed: 42 }, { playerName: "The Player" }]) {
      const s = new GameSessionAdapter();
      const warm = s.preSeedCast({ seed: 42 });
      const id = warm.house[0]!.id;
      const authored = "An authored life outside the house. With presentable, real detail.";
      expect(s.recordCastProfile({ houseguestId: id, biography: authored }).accepted).toBe(true);
      const view = s.createCharacter(finalize);
      expect(view.started).toBe(true);
      const card = view.house.find((h) => h.id === id);
      expect(card?.biography).toBe(authored);
    }
  });

  it("a DIFFERENT explicit seed discards the stale warm (the floor regenerates, authoring is not adopted)", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 100 });
    const id = warm.house[0]!.id;
    s.recordCastProfile({ houseguestId: id, biography: "Should be discarded on a seed mismatch. Two." });
    const view = s.createCharacter({ playerName: "The Player", seed: 999 });
    const card = view.house.find((h) => h.id === id);
    expect(card?.biography).not.toBe("Should be discarded on a seed mismatch. Two.");
  });

  it("graceful fallback — createCharacter without any pre-warm still starts a full deep cast", () => {
    const s = new GameSessionAdapter();
    const view = s.createCharacter({ playerName: "The Player", seed: 5 });
    expect(view.started).toBe(true);
    expect(view.house.length).toBe(15);
    expect(view.house.every((h) => typeof h.biography === "string")).toBe(true);
  });
});

describe("0065 — pre-warm holds the Vault Wall", () => {
  it("authored HIDDEN content never crosses on the warm, the re-warm, or the adopted game state", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 9 });
    const id = warm.house[0]!.id;
    const SECRET = "ZZZ-TOP-SECRET-LEDGER-0065";
    expect(s.recordCastProfile({
      houseguestId: id, secrets: [SECRET], trueGoals: ["reach the end"], weakness: "too loyal once committed",
    }).accepted).toBe(true);

    // The re-warm read carries the PUBLIC roster only — no hidden field, no secret string.
    const reread = s.preSeedCast({});
    for (const card of reread.house) {
      for (const hidden of ["secrets", "trueGoals", "weakness", "dayOnePerception"]) {
        expect(card).not.toHaveProperty(hidden);
      }
    }
    expect(JSON.stringify(reread).includes(SECRET)).toBe(false);

    // And the adopted live game state never leaks the sealed secret either.
    const view = s.createCharacter({ playerName: "The Player", seed: 9 });
    expect(JSON.stringify(view).includes(SECRET)).toBe(false);
  });
});

describe("0065 — a half-warmed (authored) cast is durable", () => {
  it("survives a snapshot→restore and is adopted with its authoring intact", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 11 });
    const id = warm.house[0]!.id;
    const authored = "A durable authored backstory. It persists across a restart.";
    s.recordCastProfile({ houseguestId: id, biography: authored });

    const core = s.snapshot();
    const restored = new GameSessionAdapter();
    restored.restore(core);
    const view = restored.createCharacter({ playerName: "The Player", seed: 11 });
    const card = view.house.find((h) => h.id === id);
    expect(card?.biography).toBe(authored);
  });
});
