import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { SealedFact } from "../../src/ports/GameSession";
import { npc, PLAYER } from "../../src/domain/ids";

/**
 * Ship-blocker A0 — the model-level KNOWLEDGE WALL. Two live playthroughs had an NPC recite the
 * player's private bedroom secret and the player's Diary-Room plan VERBATIM, though the Vault proved
 * zero in-game pathway existed for that NPC to know it. The Diary Room is a player-level OOC channel
 * with NO pathway to ANY houseguest (CLAUDE.md, "event/visibility model"); a private disclosure to
 * ONE houseguest reaches ANOTHER only along a traceable pathway (told / overheard / gossip).
 *
 * The per-NPC manifest (`npcVoice.knows`) must exclude what no pathway ever gave the speaker, and the
 * new `sealedFromHouse()` projection must hand the front-end guard the always-sealed Diary-Room set —
 * Vault-free. Roles only — no fixture names.
 */

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("A0 — the per-NPC knowledge manifest excludes un-pathwayed facts", () => {
  it("a houseguest never TOLD the player's Diary-Room plan (nor a secret told to ANOTHER) cannot voice it", () => {
    const { sb } = liveGame("kw-manifest", 4);
    const DIARY = "MY_DIARY_PLAN_backdoor_the_current_hoh_token";
    const PRIVATE_TO_A = "MY_BEDROOM_SECRET_i_have_a_final_two_token";

    // The player's Diary Room: their OWN knowledge, no in-game pathway to any houseguest.
    sb.engine.knowledge.recordDiaryRoom(DIARY);
    // The player tells houseguest A a secret in a witnessed 1:1 — A legitimately holds it; nobody else does.
    sb.engine.knowledge.seedBelief(npc(1), { content: PRIVATE_TO_A, factId: "kw:priv-a" }, "witnessed");

    // Houseguest B (npc:2) was never told either — the manifest must not carry either fact.
    const voiceB = sb.session.npcVoice(npc(2))!;
    const blobB = JSON.stringify(voiceB);
    expect(blobB).not.toContain(DIARY);
    expect(blobB).not.toContain(PRIVATE_TO_A);

    // Houseguest A holds the secret THEY were told, but the Diary Room is walled from EVERY houseguest.
    const voiceA = sb.session.npcVoice(npc(1))!;
    expect(voiceA.knows.some((k) => k.includes("final_two"))).toBe(true);
    expect(JSON.stringify(voiceA)).not.toContain(DIARY);
  });
});

describe("A0 — sealedFromHouse() is the Vault-free knowledge-wall manifest", () => {
  it("surfaces the player's Diary-Room content with an EMPTY knownTo (sealed from the whole house)", () => {
    const { sb } = liveGame("kw-sealed", 6);
    const DIARY = "MY_DIARY_PLAN_flip_the_vote_this_week_token";
    sb.engine.knowledge.recordDiaryRoom(DIARY);

    const sealed: SealedFact[] = sb.session.sealedFromHouse();
    const entry = sealed.find((s) => s.content.includes("flip_the_vote"));
    expect(entry, "the diary entry must appear in the sealed manifest").toBeDefined();
    expect(entry!.knownTo).toEqual([]); // no pathway to ANY houseguest, ever
  });

  it("does NOT surface a non-diary player secret (that class can diffuse legitimately as gossip)", () => {
    const { sb } = liveGame("kw-nondiary", 6);
    // A player-witnessed secret that could later diffuse NPC-to-NPC — enforced by the per-NPC manifest,
    // not by a blunt content scrub (which would fight the very pathway model that makes diffusion legal).
    const WITNESSED = "A_WITNESSED_SECRET_that_may_travel_token";
    // give the PLAYER a witnessed (non-diary) fact
    sb.engine.knowledge.surfaceInformationTo(PLAYER, { content: WITNESSED }, "witnessed");
    const sealed = sb.session.sealedFromHouse();
    expect(sealed.some((s) => s.content.includes("may_travel"))).toBe(false);
  });

  it("is Vault-free — no hidden confessional/soul content ever reaches the manifest", () => {
    const { sb } = liveGame("kw-vaultfree", 3);
    const DIARY = "MY_DIARY_PLAN_target_the_hoh_token";
    const VAULTED = "SENTINEL-A0-vault-confessional-content";
    sb.engine.knowledge.recordDiaryRoom(DIARY);
    sb.engine.vault.writeHidden({ id: "a0:v", kind: "confessional", content: VAULTED });

    const blob = JSON.stringify(sb.session.sealedFromHouse());
    expect(blob).toContain("target_the_hoh"); // the player's OWN diary content is present
    expect(blob).not.toContain(VAULTED); // the Vault never crosses
  });

  it("returns [] before a game is started (no house, nothing sealed)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("kw-pregame");
    expect(sb.session.sealedFromHouse()).toEqual([]);
  });
});

describe("A0 — sealedFromHouse reaches the front-end over the MCP player boundary", () => {
  it("dispatches through McpServer.callTool without being rejected as 'not available' (the wiring gate)", async () => {
    const { sb } = liveGame("kw-boundary", 9);
    const DIARY = "MY_DIARY_PLAN_win_the_veto_token";
    sb.engine.knowledge.recordDiaryRoom(DIARY);

    const out = (await sb.mcp.player.callTool("sealedFromHouse", {})) as SealedFact[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((s) => s.content.includes("win_the_veto"))).toBe(true);
  });
});
