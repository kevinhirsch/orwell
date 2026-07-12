import { describe, it, expect } from "vitest";
import { GameSessionAdapter, sanitizeAuthoredVoice } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { buildSandbox } from "../support/sandbox";

// The 2026-07-11 expressive-e2e authoring widening: `recordCastProfile` accepts an authored VOICE
// fingerprint (feature 0084 — idiolect/voice notes). Voice is IDENTITY (owner ruling 2026-06-25): it
// folds WHOLE or not at all, is PUBLIC + Vault-free (how a person talks is observable), and never
// touches a stat, lean, or hidden weight. Roles only — no names hard-coded; a mirror-guard case reads
// the player's name from the engine's own state.

const WELL_FORMED_VOICE = {
  register: "plainspoken",
  rhythm: "clipped",
  energy: "warm",
  directness: "blunt",
  humor: "dry",
  stressTell: "goes quiet",
  signature: "lands every point like it's the last word",
  lexicon: ["honestly", "for real"],
};

describe("expressive-e2e — recordCastProfile folds a well-formed authored voice", () => {
  it("accepts a complete voice fingerprint and reports it as a PUBLIC field", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 21 });
    const npc = s.getGameState().house[0]!;
    const res = s.recordCastProfile({ houseguestId: npc.id, voice: WELL_FORMED_VOICE });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("voice");
    // The roster card's rendered voice clause re-derives from the authored dials (0084 fingerprint).
    const card = s.getGameState().house.find((h) => h.id === npc.id)!;
    expect(card.voice).toContain("plainspoken");
    expect(card.voice).toContain("clipped");
  });

  it("folds on the PRE-WARMED (pre-game) cast too — the common authoring path", () => {
    const s = new GameSessionAdapter();
    const warm = s.preSeedCast({ seed: 5 });
    const res = s.recordCastProfile({ houseguestId: warm.house[0]!.id, voice: WELL_FORMED_VOICE });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("voice");
  });

  it("normalizes whitespace and trims/bounds the lexicon", () => {
    expect(sanitizeAuthoredVoice({
      ...WELL_FORMED_VOICE,
      register: "  polished \n and  formal ",
      lexicon: ["  okay so ", "", "literally", "x".repeat(200), "wait", "right?", "extra-beyond-cap"],
    })).toEqual({
      ...WELL_FORMED_VOICE,
      register: "polished and formal",
      // empties + over-long entries dropped, then capped at 4
      lexicon: ["okay so", "literally", "wait", "right?"],
    });
  });
});

describe("expressive-e2e — a partial/malformed voice is DROPPED whole (the seeded floor stands)", () => {
  it.each([
    ["a missing dial", { ...WELL_FORMED_VOICE, stressTell: undefined }],
    ["an empty dial", { ...WELL_FORMED_VOICE, humor: "   " }],
    ["a non-string dial", { ...WELL_FORMED_VOICE, energy: 42 }],
    ["an over-long dial", { ...WELL_FORMED_VOICE, register: "x".repeat(300) }],
    ["a missing lexicon", { ...WELL_FORMED_VOICE, lexicon: undefined }],
    ["an all-garbage lexicon", { ...WELL_FORMED_VOICE, lexicon: ["", 7, "   "] }],
    ["a non-object", "talks fast"],
    ["an array", [WELL_FORMED_VOICE]],
    ["null", null],
  ])("%s sanitizes to null", (_label, bad) => {
    expect(sanitizeAuthoredVoice(bad)).toBeNull();
  });

  it("a partial voice never fails the whole call — the other authored fields still land", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 9 });
    const npc = s.getGameState().house[0]!;
    const before = s.getGameState().house.find((h) => h.id === npc.id)!.voice;
    const res = s.recordCastProfile({
      houseguestId: npc.id,
      biography: "A real two-sentence backstory. It has presentable parts and genuine texture.",
      voice: { register: "plainspoken" } as never, // partial — voice folds whole or not at all
    });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("biography");
    expect(res.publicFields).not.toContain("voice");
    // The seeded deterministic voice (the floor) stands untouched.
    expect(s.getGameState().house.find((h) => h.id === npc.id)!.voice).toBe(before);
  });
});

describe("expressive-e2e — the voice joins the public mirror guard (anti-sycophancy #3)", () => {
  it("a voice woven around the player refuses the whole call", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 4 });
    const playerName = s.getGameState().player!.name;
    const npc = s.getGameState().house[0]!;
    const res = s.recordCastProfile({
      houseguestId: npc.id,
      voice: { ...WELL_FORMED_VOICE, signature: `always circles back to ${playerName} in every story` },
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toContain("mirrors the player");
  });
});

describe("expressive-e2e — the voice field crosses the MCP boundary (the four-place write-back rule)", () => {
  function playerServer(): McpServer {
    const sb = buildSandbox(1);
    const session = new GameSessionAdapter();
    const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
    return new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  }

  it("dispatches recordCastProfile WITH a voice object through callTool (never dead at runtime)", async () => {
    const server = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 5 })) as { warmed: boolean; house: { id: string }[] };
    expect(warm.warmed).toBe(true);
    const res = (await server.callTool("recordCastProfile", {
      houseguestId: warm.house[0]!.id, voice: WELL_FORMED_VOICE,
    })) as { accepted: boolean; publicFields: string[] };
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("voice");
  });

  it("refuses a non-object voice at the boundary shape guard", async () => {
    const server = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 5 })) as { warmed: boolean; house: { id: string }[] };
    await expect(server.callTool("recordCastProfile", {
      houseguestId: warm.house[0]!.id, voice: "talks fast" as never,
    })).rejects.toThrow(/voice/);
  });
});
