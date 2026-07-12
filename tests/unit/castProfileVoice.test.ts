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

// #1395 — the idiolect card carries an OPTIONAL small set of characteristic PHRASINGS (how THIS person
// puts things). Authored at casting, folded whole onto the static CHARACTER voice, rendered to the
// narrator as facts-to-voice (never a repeated bit). It is a BONUS on a well-formed core voice: absent
// or garbage ⇒ dropped, never a whole-voice failure.
const WELL_FORMED_VOICE_WITH_CATCHPHRASES = {
  ...WELL_FORMED_VOICE,
  catchphrases: ["at the end of the day", "we move"],
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

describe("#1395 — per-NPC idiolect catchphrases fold, surface to the narrator, and stay byte-stable", () => {
  it("folds an authored catchphrase set onto the static CHARACTER voice", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 21 });
    const npc = s.getGameState().house[0]!;
    const res = s.recordCastProfile({ houseguestId: npc.id, voice: WELL_FORMED_VOICE_WITH_CATCHPHRASES });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("voice");
    // The catchphrases land on the static CHARACTER voice (byte-persisted, not the roster string).
    const character = s.snapshot().house!.npcs.find((n) => n.id === npc.id)!.character;
    expect(character.voice!.catchphrases).toEqual(["at the end of the day", "we move"]);
  });

  it("surfaces the catchphrases to the narrator via npcVoice (facts-to-voice)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 7 });
    const npc = s.getGameState().house[0]!;
    s.recordCastProfile({ houseguestId: npc.id, voice: WELL_FORMED_VOICE_WITH_CATCHPHRASES });
    // npcVoice carries the FULL fingerprint (the deep-scene read the narrator voices them through).
    const view = s.npcVoice(npc.id)!;
    expect(view.persona.voice!.catchphrases).toEqual(["at the end of the day", "we move"]);
  });

  it("trims, whitespace-collapses, and caps the catchphrases at 3", () => {
    expect(sanitizeAuthoredVoice({
      ...WELL_FORMED_VOICE,
      catchphrases: ["  we   move ", "", "  it is what   it is ", "x".repeat(200), "no cap", "one too many"],
    })).toEqual({
      ...WELL_FORMED_VOICE,
      // empties + over-long entries dropped, whitespace collapsed, then capped at 3
      catchphrases: ["we move", "it is what it is", "no cap"],
    });
  });

  it("drops garbage catchphrases but STILL folds the core voice (a bonus, never a gate)", () => {
    // All-garbage catchphrases ⇒ omitted; the well-formed core voice still lands whole.
    expect(sanitizeAuthoredVoice({ ...WELL_FORMED_VOICE, catchphrases: ["", 7, "   "] })).toEqual(WELL_FORMED_VOICE);
    // A non-array catchphrases value is ignored the same way.
    expect(sanitizeAuthoredVoice({ ...WELL_FORMED_VOICE, catchphrases: "we move" })).toEqual(WELL_FORMED_VOICE);
    // And a full recordCastProfile with garbage catchphrases is still accepted (voice folds without them).
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 3 });
    const npc = s.getGameState().house[0]!;
    const res = s.recordCastProfile({
      houseguestId: npc.id,
      voice: { ...WELL_FORMED_VOICE, catchphrases: ["", "   "] } as never,
    });
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("voice");
    expect(s.snapshot().house!.npcs.find((n) => n.id === npc.id)!.character.voice!.catchphrases).toBeUndefined();
  });

  it("keeps the catchphrases byte-stable across a snapshot save/restore (non-degradation pin)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "The Player", seed: 21 });
    const npc = s.getGameState().house[0]!;
    s.recordCastProfile({ houseguestId: npc.id, voice: WELL_FORMED_VOICE_WITH_CATCHPHRASES });
    const before = s.snapshot().house!.npcs.find((n) => n.id === npc.id)!.character.voice;
    // Lossless persistence round-trip (JSON, the save path) → restore into a fresh session.
    const core = JSON.parse(JSON.stringify(s.snapshot()));
    const s2 = new GameSessionAdapter();
    s2.restore(core);
    const after = s2.snapshot().house!.npcs.find((n) => n.id === npc.id)!.character.voice;
    expect(after).toEqual(before);
    expect(after!.catchphrases).toEqual(["at the end of the day", "we move"]);
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

  it("#1395 — the catchphrases ride the voice object across the MCP boundary (round-trips engine→store→recall)", async () => {
    const server = playerServer();
    // createCharacter builds the live house (so the recall path npcVoice reads is populated).
    const game = (await server.callTool("createCharacter", { playerName: "The Player", seed: 5 })) as { house: { id: string }[] };
    const id = game.house[0]!.id;
    const res = (await server.callTool("recordCastProfile", {
      houseguestId: id, voice: WELL_FORMED_VOICE_WITH_CATCHPHRASES,
    })) as { accepted: boolean; publicFields: string[] };
    expect(res.accepted).toBe(true);
    expect(res.publicFields).toContain("voice");
    // Recall it through the same MCP boundary: npcVoice returns the folded catchphrases (engine is truth).
    const view = (await server.callTool("npcVoice", { id })) as { persona: { voice?: { catchphrases?: string[] } } };
    expect(view.persona.voice!.catchphrases).toEqual(["at the end of the day", "we move"]);
  });

  it("refuses a non-object voice at the boundary shape guard", async () => {
    const server = playerServer();
    const warm = (await server.callTool("preSeedCast", { seed: 5 })) as { warmed: boolean; house: { id: string }[] };
    await expect(server.callTool("recordCastProfile", {
      houseguestId: warm.house[0]!.id, voice: "talks fast" as never,
    })).rejects.toThrow(/voice/);
  });
});
