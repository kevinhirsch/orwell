import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { renderGameContext } from "../../src/engine/momentPrompts";
import { producerPrompt, deriveNpcKnowledge, NO_NPC_PATHWAY } from "../../src/engine/diaryRoom";
import { resolvePending } from "../support/adr0003";
import { PLAYER } from "../../src/domain/ids";

// Feature 0115 — the Diary Room as a strategic confessional. The player's DR intent GROUNDS the GM's
// narration (so the game narrates the player's REAL strategy, not their public mask), the producer's
// invitations become pointed beat-specific questions, and the confessionals resurface post-season — all
// while the house stays STRUCTURALLY deceived. HARD rule: roles only, no cast names.

const startedGame = (seed = 11, user = "user-a") => {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "Player", seed });
  return sb;
};

const driveToFinish = (sb: ReturnType<GameSessionRegistry["sandboxFor"]>): void => {
  for (let i = 0; i < 4000; i++) {
    const v = sb.session.advanceGame();
    if (v.pending) resolvePending(sb.session, v.pending);
    if (v.finished || sb.session.snapshot().live?.winner !== undefined) return;
  }
  throw new Error("the season never finished");
};

describe("0115 — the player's Diary Room grounds the GM's narration (walled from the house)", () => {
  it("surfaces the player's DR strategy in the narrator's game context, fenced as a PRIVATE do-not-voice steer", async () => {
    const sb = startedGame();
    await sb.mcp.player.callTool("diaryRoom", { entry: "I keep telling them we're ride-or-die but I am gunning for them" });

    const view = sb.session.getGameState();
    // The player's own view carries their DR intent (Vault-free — their own knowledge, not a Vault read).
    expect(view.playerDiaryRoom ?? []).toContain("I keep telling them we're ride-or-die but I am gunning for them");

    // The narrator's context carries it AND marks it private (known to the GM, not the houseguests).
    const ctx = renderGameContext(view);
    expect(ctx).toContain("gunning for them");
    expect(ctx.toLowerCase()).toMatch(/diary.?room/);
    // A private steer: the context must flag it as GM-only / never-voice, not a fact to read aloud.
    expect(ctx.toLowerCase()).toMatch(/private|do not voice|never voice|the house does not|not to the houseguests/);
  });

  it("is absent from the game context before the player records anything", () => {
    const sb = startedGame(7, "user-empty");
    const view = sb.session.getGameState();
    expect(view.playerDiaryRoom ?? []).toEqual([]);
    expect(renderGameContext(view).toLowerCase()).not.toContain("the player's diary room");
  });
});

describe("0115 — the wall stays STRUCTURAL: no houseguest learns or acts on the DR strategy", () => {
  it("a planted DR secret reaches the narrator context but NEVER any NPC's knowledge or voicing projection", async () => {
    const sb = startedGame(23, "user-wall");
    // Reach the live house so NPC voicing projections exist.
    for (let i = 0; i < 60 && sb.session.snapshot().live?.hoh === undefined; i++) {
      const v = sb.session.advanceGame();
      if (v.pending) resolvePending(sb.session, v.pending);
    }
    const SECRET = "DR_STRAT_SENTINEL_no_npc_may_know_115";
    await sb.mcp.player.callTool("diaryRoom", { entry: SECRET });

    // Present on the player-facing side (their view + the GM context).
    expect((sb.session.getGameState().playerDiaryRoom ?? []).join("|")).toContain(SECRET);
    expect(renderGameContext(sb.session.getGameState())).toContain(SECRET);

    // STRUCTURAL wall: no NPC knows it, and deriveNpcKnowledge strips it.
    const npcIds = sb.session.snapshot().house!.npcs.map((n) => n.id);
    for (const id of npcIds) {
      expect(sb.engine.knowledge.knownTo(id).some((k) => k.content.includes(SECRET))).toBe(false);
    }
    const drFact = sb.engine.knowledge.knownTo(PLAYER).find((k) => k.content.includes(SECRET));
    expect(drFact).toBeDefined();
    expect(drFact!.pathway).toBe(NO_NPC_PATHWAY);
    expect(deriveNpcKnowledge([drFact!])).toEqual([]);

    // ...and no per-NPC voicing projection (the model's houseguest voice) carries it.
    for (const id of npcIds) {
      const voice = sb.session.npcVoice(id);
      if (voice) expect(JSON.stringify(voice)).not.toContain(SECRET);
    }
  });
});

describe("0115 — the producer's DR invitation is a pointed, beat-specific question", () => {
  it("dramatic beats ask a question specific to that beat (not the generic label)", () => {
    for (const beat of ["nomination", "veto-ceremony", "eviction"] as const) {
      const p = producerPrompt(beat);
      expect(p.invite).toBe(true);
      expect(p.reason).toBeDefined();
      // A real confessional question, not the old "dramatic beat: X" label.
      expect(p.reason).not.toMatch(/^dramatic beat:/);
      expect(p.reason!.length).toBeGreaterThan(15);
      expect(p.reason).toMatch(/\?$/); // it asks something
    }
  });

  it("routine beats still yield no invitation", () => {
    for (const beat of ["routine-chat", "idle", "downtime"] as const) {
      expect(producerPrompt(beat).invite).toBe(false);
    }
  });
});

describe("0115 — the confessional through-line resurfaces post-season (0048)", () => {
  it("the retrospective surfaces the player's own confessionals; nothing while the season is live", async () => {
    const sb = startedGame(5, "user-retro");
    await sb.mcp.player.callTool("diaryRoom", { entry: "My whole game is quietly running the house" });

    // Live: the retrospective stays sealed.
    expect(sb.session.seasonRetrospective()).toBeNull();

    driveToFinish(sb);
    const retro = sb.session.seasonRetrospective();
    expect(retro).not.toBeNull();
    expect(retro!.playerConfessionals).toEqual(expect.arrayContaining(["My whole game is quietly running the house"]));
  });
});

describe("0115 — the strategic Diary Room leaks no hidden state (Vault-free)", () => {
  it("the narrator context under a populated Vault carries no planted sentinel", async () => {
    const sb = startedGame(41, "user-vault");
    const SENT = "VAULT_115_SENTINEL";
    sb.engine.vault.writeHidden({ id: "v115", kind: "hidden-attribute", content: `hidden ${SENT}` });
    await sb.mcp.player.callTool("diaryRoom", { entry: "my private read" });

    const ctx = renderGameContext(sb.session.getGameState());
    expect(ctx).not.toContain(SENT);
  });
});
