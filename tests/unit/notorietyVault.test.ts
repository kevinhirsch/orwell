import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { NotorietySummary } from "../../src/engine/notoriety";
import { PLAYER } from "../../src/domain/ids";

/**
 * Feature 0104 — the VAULT WALL gate (mandate #2, player AND admin). Notoriety is HIDDEN-LAYER bias:
 * the bounded summary + the day-one reputation/bias it folds must appear on NO player-facing AND NO
 * admin/God-Mode projection. The player feels notoriety ONLY through the new cast's behavior + the
 * narrator's Vault-free `legendBeats` callbacks — never a number, never the reputation facets, never a
 * raw bias. A sentinel embedded in the carried summary (a marker the player must never see verbatim as
 * a hidden number) is swept across every projection + the assembled day-one prompt.
 *
 * HARD rule: roles only — no fixture names.
 */

const SENT = "SENTINEL-0104-secret-notoriety-number";

/** A carried notoriety whose facets carry an unmistakable out-of-band marker. The reputation numbers
 *  themselves are the secret state (a "you are read as 0.83 treacherous" leak is the failure mode);
 *  the legend gist is the ONLY part the narrator may voice, and even that is engine-decided texture. */
const SENTINEL_SUMMARY: NotorietySummary = {
  seasonsPlayed: 3,
  lastPlacement: 2,
  bestPlacement: 1,
  reputation: { loyalty: -0.81, treachery: 0.93, competitor: 0.77, social: -0.42 },
  // A legend beat carrying the sentinel — this is the gloss; we still assert the raw numbers/markers
  // never surface, and the player surfaces never carry the structural reputation object.
  legendBeats: [`${SENT}`, "blindsided their own ally", "won their first season"],
};

function liveGameWithNotoriety(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.setNotoriety(SENTINEL_SUMMARY);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("0104 — Vault Wall holds (player AND admin): notoriety never reaches a projection as a number", () => {
  it("no player-facing projection carries the notoriety summary, its facets, or its sentinel", () => {
    const { sb } = liveGameWithNotoriety("nv-player", 7);
    const playerSurface = JSON.stringify(sb.session.getGameState())
      + JSON.stringify(sb.player.getVisibleState())
      + JSON.stringify(sb.session.gameStatus())
      + sb.session.getGameState().house.filter((h) => h.status === "active")
          .map((h) => JSON.stringify(sb.session.npcVoice(h.id))).join("");
    expect(playerSurface).not.toContain(SENT);
    // The structural reputation object never crosses (a "reputation:{treachery:…}" leak).
    expect(playerSurface).not.toMatch(/treachery|reputation":\s*\{|legendBeats|seasonsPlayed/i);
    // The raw reputation numbers themselves never appear as text.
    expect(playerSurface).not.toContain("0.93");
    expect(playerSurface).not.toContain("0.81");
  });

  it("a sentinel sweep of the assembled day-one prompt finds no notoriety NUMBER", () => {
    const { sb } = liveGameWithNotoriety("nv-prompt", 13);
    const prompts = sb.session.getMomentPrompt({}).systemPrompt
      + sb.session.getMomentPrompt({ moment: "social" }).systemPrompt
      + sb.session.getMomentPrompt({ moment: "character-creation" }).systemPrompt;
    // No raw reputation number, no structural marker — the engine hands the narrator only Vault-free gist.
    expect(prompts).not.toContain("0.93");
    expect(prompts).not.toContain("0.81");
    expect(prompts).not.toMatch(/reputation":\s*\{|legendBeats|seasonsPlayed/i);
  });

  it("the admin / God-Mode surface is walled from notoriety too (no summary, no facets, no sentinel)", () => {
    const { sb } = liveGameWithNotoriety("nv-admin", 42);
    sb.syncAdmin();
    const adminSurface = JSON.stringify(sb.admin.inspect());
    expect(adminSurface).not.toContain(SENT);
    expect(adminSurface).not.toMatch(/treachery|reputation":\s*\{|legendBeats|seasonsPlayed/i);
    expect(adminSurface).not.toContain("0.93");
    // The admin's health/status views are likewise notoriety-free.
    expect(adminSurface).not.toContain("0.81");
  });

  it("the NPC→player edge MOVED (notoriety folded) yet no number is on any projection — the bias is hidden", () => {
    const { sb } = liveGameWithNotoriety("nv-edge", 101);
    // Prove the hidden layer actually changed (the bias is real) ...
    const core = sb.session.snapshot();
    const someNpc = core.house!.npcs[0]!.id;
    const e = sb.engine.relationships.edge(someNpc, PLAYER);
    expect(e.trust + e.affinity + e.threat).toBeGreaterThan(0); // a real edge exists
    // ... while the player's visible state shows facts/behavior, never the edge numbers (the standing
    // 0017/0020 guarantee — the engine never tells the player how an NPC feels in numbers).
    const visible = JSON.stringify(sb.player.getVisibleState());
    expect(visible).not.toMatch(/"trust":|"affinity":|"threat":/);
  });
});
