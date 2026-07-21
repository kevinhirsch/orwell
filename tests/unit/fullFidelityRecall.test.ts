import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER } from "../../src/domain/ids";

/**
 * L27b — LLM-authored detail must persist + recall in FULL fidelity (never flattened), and the
 * engine must be weight-aware. Building on L27 (scene recall-fold) and L28b (cast-profile recall):
 *
 *   (a) recording captures ENOUGH detail for full-fidelity recall (the summary is stored verbatim,
 *       not over-summarized to a one-liner);
 *   (b) every established detail is durably stored + semantically recallable N TURNS LATER — through
 *       many intervening records AND a real engine RESTART (the store recalled, never the chat
 *       remembered);
 *   (c) weight-bearing details fold their HIDDEN impact (the 0023 consequence fold) and that impact
 *       persists across the restart.
 *
 * Roles only — no names asserted (testing rule). The restart is the true new-process analogue: a
 * brand-new `GameSessionRegistry` over a `FileSaveStore` on the SAME data dir, exactly as 0030's
 * durable-persistence suite restarts (so events, the relationship model, AND souls all reload).
 *
 * The gap this closes: a scene recorded via `recordInteraction` was indexed into the SoulStore's
 * vector index ALONE (derived state). `rebuildSoulIndex` re-derives the index ONLY from each
 * houseguest's PERSISTED `soul.memory` mirror, so a scene's semantic recall silently vanished on
 * restart — the event record survived, but the NPC could no longer RECALL the scene. The fix routes
 * the recall-fold through `recordSceneMemory`, which writes the persisted mirror too.
 */
describe("L27b — full-fidelity recall N turns later (across records + a real restart)", () => {
  const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-l27b-"));
  const USER = "l27b-user";

  // A genuinely RICH, detailed scene summary — not a one-liner. Full-fidelity recall means THIS exact
  // text comes back, with every specific, never a flattened paraphrase.
  const RICH_DETAIL =
    "On the hammock after the comp, you and your ally traded real backstory: they grew up the youngest " +
    "of six in a logging town, blew their college fund on a failed food truck, and came on the show to " +
    "finally prove their late father wrong — and in the same breath they swore a final-two on it, asking " +
    "only that you never put their name in your mouth to the loud side of the house.";

  it("(a)+(b) a richly-authored scene established N turns ago recalls IN FULL (not flattened) after a restart", () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    const sb = before.sandboxFor(USER);
    sb.session.createCharacter({ playerName: "The Player", seed: 71 });
    sb.session.advanceGame(); // close the premiere circle so movePlayer works (0111) — co-locate for BL-014
    const ally = sb.session.livingIds().find((id) => id !== PLAYER)!;
    const others = sb.session.livingIds().filter((id) => id !== PLAYER && id !== ally);

    // Turn N: record the rich detail with the ally. BL-014: a scene is recorded from the PLAYER's room,
    // and the engine now drops a named witness its own occupancy places elsewhere — co-locate so the
    // ally is genuinely co-present for the scene the player and ally shared.
    sb.session.movePlayer(sb.session.occupancy()!.get(ally)!);
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, ally], kind: "bonding", content: RICH_DETAIL });

    // …then MANY intervening turns of other social play (the "N turns later" pressure). The rich
    // detail must not be flattened, overwritten, or buried out of recall.
    for (let i = 0; i < 30; i++) {
      const partner = others[i % others.length]!;
      sb.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "strategy",
        content: `Filler scene ${i}: a quick check-in with a houseguest about the upcoming vote.`,
      });
    }

    // Same-session full-fidelity recall: the EXACT rich text returns, with its specifics intact.
    const recalledLive = sb.engine.soul.recall(ally, "their backstory, the food truck, and the final-two promise", 5);
    expect(recalledLive.some((m) => m.content === RICH_DETAIL)).toBe(true);

    // (b) DURABLE across a REAL restart: a fresh registry + store over the same dir (new-process
    // analogue). This is what used to lose the scene's recall — the persisted mirror now carries it.
    const after = new GameSessionRegistry(new FileSaveStore(dir));
    const sb2 = after.sandboxFor(USER);
    expect(sb2.session.getGameState().started).toBe(true);

    const recalledAfter = sb2.engine.soul.recall(ally, "their backstory, the food truck, and the final-two promise", 5);
    expect(recalledAfter.some((m) => m.content === RICH_DETAIL)).toBe(true);
    // Full fidelity, NOT a one-line digest: the exact long string survives, every specific intact.
    const restoredText = recalledAfter.map((m) => m.content).join("\n");
    expect(restoredText).toContain("youngest");
    expect(restoredText).toContain("logging town");
    expect(restoredText).toContain("failed food truck");
    expect(restoredText).toContain("never put their name in your mouth");
    // and the event record still holds it (the player's own witnessed knowledge — survives the restart).
    expect(sb2.engine.events.queryAll().some((e) => e.content === RICH_DETAIL)).toBe(true);
  });

  it("(c) a weight-bearing scene folds a HIDDEN relationship impact that the player never sees and that persists across a restart", () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    const sb = before.sandboxFor(USER);
    sb.session.createCharacter({ playerName: "The Player", seed: 72 });
    sb.session.advanceGame(); // close the premiere circle so movePlayer works (0111) — co-locate for BL-014
    const ally = sb.session.livingIds().find((id) => id !== PLAYER)!;

    // The hidden NPC→player edge BEFORE the weight-bearing scene.
    const beforeEdge = { ...sb.engine.relationships.edge(ally, PLAYER) };

    // A betrayal is weight-bearing: its `kind` folds the hidden impact (the 0023 consequence fold).
    // BL-014: co-locate so the ally is a genuine co-present participant (the engine drops a named
    // witness placed elsewhere, which would otherwise skip the directed fold under test).
    sb.session.movePlayer(sb.session.occupancy()!.get(ally)!);
    sb.commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, ally], kind: "betrayal",
      content: "You went back on your word to the ally in front of the whole house, naming them as a target.",
    });
    const afterEdge = sb.engine.relationships.edge(ally, PLAYER);

    // The hidden weight MOVED (the consequence is real, recorded, invisible).
    const moved =
      Math.abs(afterEdge.trust - beforeEdge.trust) > 1e-9 ||
      Math.abs(afterEdge.affinity - beforeEdge.affinity) > 1e-9 ||
      Math.abs(afterEdge.threat - beforeEdge.threat) > 1e-9;
    expect(moved).toBe(true);

    // The player NEVER sees the numbers (the Vault Wall working): no edge/number on any player surface.
    const playerSurface =
      JSON.stringify(sb.session.getGameState()) +
      JSON.stringify(sb.player.getVisibleState()) +
      JSON.stringify(sb.session.npcVoice(ally));
    expect(playerSurface).not.toMatch(/"trust":|"affinity":|"threat":/);

    // …and the moved weight PERSISTS across a real restart (non-degradation #4).
    const after = new GameSessionRegistry(new FileSaveStore(dir));
    const sb2 = after.sandboxFor(USER);
    const restored = sb2.engine.relationships.edge(ally, PLAYER);
    expect(restored.trust).toBeCloseTo(afterEdge.trust, 9);
    expect(restored.affinity).toBeCloseTo(afterEdge.affinity, 9);
    expect(restored.threat).toBeCloseTo(afterEdge.threat, 9);
  });

  it("an authored cast-profile DETAIL recalls in full N records later and after a restart (not flattened)", () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    const sb = before.sandboxFor(USER);
    sb.session.createCharacter({ playerName: "The Player", seed: 73 });
    const id = sb.session.getGameState().house[0]!.id;

    // The producer-LLM authors a richly-detailed hidden secret (L28b write-back).
    const RICH_SECRET =
      "carries a quiet, specific debt — eleven thousand dollars to a former business partner who " +
      "co-signed the lease on the bakery that closed, and the prize is the only clean way to make it " +
      "right before the partner's patience runs out";
    expect(sb.session.recordCastProfile({ houseguestId: id, secrets: [RICH_SECRET] }).accepted).toBe(true);

    // Bury it under many later social records (the "N turns later" pressure).
    const others = sb.session.livingIds().filter((x) => x !== PLAYER && x !== id);
    for (let i = 0; i < 20; i++) {
      const partner = others[i % others.length]!;
      sb.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "strategy",
        content: `Unrelated check-in ${i}.`,
      });
    }

    // Recall the authored secret in FULL (engine-only — it never crosses the wall, but recalls whole).
    const recalled = sb.engine.soul.recall(id, "the debt to the former business partner and the bakery lease", 5);
    const text = recalled.map((m) => m.content).join("\n");
    expect(text).toContain("eleven thousand dollars");
    expect(text).toContain("bakery that closed");

    // Durable across a real restart.
    const after = new GameSessionRegistry(new FileSaveStore(dir));
    const sb2 = after.sandboxFor(USER);
    const recalled2 = sb2.engine.soul.recall(id, "the debt to the former business partner and the bakery lease", 5);
    const text2 = recalled2.map((m) => m.content).join("\n");
    expect(text2).toContain("eleven thousand dollars");
    expect(text2).toContain("co-signed the lease");

    // The authored secret NEVER reaches the player/admin (the Vault Wall holds for full-recall detail).
    const surface =
      JSON.stringify(sb2.session.getGameState()) +
      sb2.session.getMomentPrompt({ moment: "social" }).systemPrompt +
      JSON.stringify(sb2.session.npcVoice(id));
    expect(surface).not.toContain("eleven thousand dollars");
  });
});
