import { describe, it, expect } from "vitest";
import { GameSessionAdapter, isReasonableName } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { buildSandbox } from "../support/sandbox";

// LLM-generated cast names land via recordCastProfile.name (PUBLIC). The engine's corpus sampling
// stays the deterministic fail-soft FALLBACK: a bad/colliding/absent name leaves the seeded name.
// Roles only — the names below are FORMAT-only test fixtures, never canonical cast.

const GIBBERISH = "Nerighrengeinen Herneingenenin";

describe("isReasonableName — the structural gate on an authored display name", () => {
  it("accepts ordinary real-sounding two-token names", () => {
    expect(isReasonableName("Marcus Webb")).toBe(true);
    expect(isReasonableName("Priya Anand")).toBe(true);
    expect(isReasonableName("Mary-Kate O'Neil")).toBe(true);
  });

  it("rejects fantasy/gibberish and malformed names", () => {
    expect(isReasonableName(GIBBERISH)).toBe(false);
    expect(isReasonableName("Madonna")).toBe(false); // single token
    expect(isReasonableName("marcus webb")).toBe(false); // not capitalized
    expect(isReasonableName("X Y")).toBe(false); // too short / no vowel
    expect(isReasonableName("Brrtthh Smith")).toBe(false); // 4+ consonant run
  });
});

describe("recordCastProfile.name — LLM name with the corpus fallback floor", () => {
  function startedGame(): { s: GameSessionAdapter; ids: string[]; seededNames: Record<string, string> } {
    const s = new GameSessionAdapter();
    const view = s.createCharacter({ playerName: "The Player", seed: 7 });
    const ids = view.house.map((h) => h.id);
    const seededNames: Record<string, string> = {};
    for (const h of view.house) seededNames[h.id] = h.name;
    return { s, ids, seededNames };
  }

  function nameOf(s: GameSessionAdapter, id: string): string | undefined {
    return s.getGameState().house.find((h) => h.id === id)?.name;
  }

  it("(a) a reasonable name updates the houseguest's projected name (on the pre-warm path, before the champagne circle locks names)", () => {
    // Naming applies PRE-GAME, on a pre-warm cast — the point where deep authoring (re)names the house
    // before `createCharacter` adopts it. Once the game starts, the champagne circle meets the whole house
    // at the toast and every name is frozen (A1), so acceptance is proven here on the un-locked pre-warm.
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 7 });
    expect(warm.warmed).toBe(true);
    const id = warm.house[0]!.id;
    const res = s.recordCastProfile({ houseguestId: id, name: "Marcus Webb" });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("name");
  });

  it("(b) a gibberish name is rejected; corpus name stands but the rest of the profile still applies", () => {
    const { s, ids, seededNames } = startedGame();
    const res = s.recordCastProfile({
      houseguestId: ids[0]!,
      name: GIBBERISH,
      biography: "A real authored backstory. It has presentable parts.",
    });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).not.toContain("name");
    expect(res.publicFields).toContain("biography");
    expect(nameOf(s, ids[0]!)).toBe(seededNames[ids[0]!]); // unchanged
    expect(s.getGameState().house.find((h) => h.id === ids[0]!)?.biography)
      .toBe("A real authored backstory. It has presentable parts.");
  });

  it("(c) a name colliding with another houseguest is rejected", () => {
    const { s, ids, seededNames } = startedGame();
    const otherName = seededNames[ids[1]!]!;
    const res = s.recordCastProfile({ houseguestId: ids[0]!, name: otherName });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).not.toContain("name");
    expect(nameOf(s, ids[0]!)).toBe(seededNames[ids[0]!]); // unchanged corpus name
  });

  it("(d) an absent name leaves the corpus name unchanged", () => {
    const { s, ids, seededNames } = startedGame();
    const res = s.recordCastProfile({ houseguestId: ids[0]!, weakness: "too loyal once committed" });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).not.toContain("name");
    expect(nameOf(s, ids[0]!)).toBe(seededNames[ids[0]!]);
  });
});

describe("recordCastProfile.name reaches the engine over the MCP boundary", () => {
  function playerServer(): McpServer {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    return new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  }

  it("the name arg passes the arg-guard and is applied (the boundary bug)", async () => {
    const server = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 5 })) as { warmed: boolean; house: { id: string }[] };
    expect(warm.warmed).toBe(true);
    const res = (await server.callTool("recordCastProfile", {
      houseguestId: warm.house[0]!.id, name: "Priya Anand",
    })) as { accepted: boolean; publicFields: string[] };
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("name");
  });
});
