import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER } from "../../src/domain/ids";
import type { VisibleState } from "../../src/services/VisibleStateService";
import type { SeasonRecapView } from "../../src/ports/GameSession";

/**
 * "The conversation is NOT amnesic." — the product's spine (PO ask; ADR 0003 principle #6:
 * long-term memory is the STORE recalled, never the chat remembered; mandate #4 non-degradation;
 * feature 0023 the consequence/memory loop; 0024 soul recall; 0007 non-degradation).
 *
 * The exact behavioral contract under test:
 *   an NPC passively mentions a SMALL, UNINTERESTING part of their life early on; in LATE game,
 *   buried under masses of later play, the player must STILL be able to recall that thing, and it
 *   must be recallable from MCP as "a thing that happened" — because humans remember things like
 *   that. It can't just be amnesic on conversation.
 *
 * This is deliberately the LOW-SALIENCE inverse of `fullFidelityRecall.test.ts` (which proves a
 * RICH, weight-bearing scene survives, and asserts the soul recall + the raw event record
 * directly). The gap this fills:
 *   (1) a small, throwaway life detail — NOT a game event, NOT weight-bearing — and
 *   (2) the MCP-accessible PLAYER-CHANNEL read (`getVisibleStateFor` via `mcp.player.callTool`),
 *       which `fullFidelityRecall` never exercises.
 * If `recordInteraction` stopped persisting, or recall flattened/dropped old low-salience
 * memories, or the player-channel event read pruned them, this test FAILS.
 *
 * HARD testing rules: roles only — no names asserted; the player-channel read is proven Vault-free.
 */
describe("the conversation is NOT amnesic — a small life detail mentioned early recalls late-game", () => {
  const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-conv-memory-"));
  const USER = "conv-memory-user";

  // A SMALL, uninteresting life detail an NPC drops in passing — NOT a game event, NOT a scheme.
  // The specific, low-salience kind of thing a human remembers ("oh, you mentioned your dog…").
  // The unique token (the bridge / the rescue greyhound) is what we prove survives, full-fidelity.
  const SMALL_DETAIL =
    "While waiting for the kettle, they mentioned offhand that they have a rescue greyhound named " +
    "Pemberton back home, and that they got it after seeing it shivering under a bridge one rainy " +
    "Tuesday — nothing to do with the game, just a quiet thing about their life.";
  // A handful of specific tokens from the detail; full-fidelity recall means every one survives.
  const DETAIL_TOKENS = ["rescue greyhound", "Pemberton", "shivering under a bridge", "rainy"];
  // A recall CONTEXT relevant to the detail but NOT a substring of it — so a hit proves SEMANTIC
  // relevance ranking, not a literal text match.
  const RECALL_CONTEXT = "the dog they adopted from the street back home";

  const tokensIn = (haystack: string): boolean => DETAIL_TOKENS.every((t) => haystack.includes(t));

  it("survives masses of later play AND a real restart — recallable via MCP and via the soul, full-fidelity, never pruned", async () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    const sb = before.sandboxFor(USER);
    sb.session.createCharacter({ playerName: "The Player", seed: 91 });
    // Close the premiere champagne circle so the player is in normal free-roam presence (movePlayer is
    // pinned until then, 0111) — needed to co-locate for a genuinely co-present scene (BL-014).
    sb.session.advanceGame();

    const npcs = sb.session.livingIds().filter((id) => id !== PLAYER);
    const teller = npcs[0]!;             // the houseguest who drops the small detail
    const others = npcs.slice(1);

    // --- EARLY game (week 1): the player witnesses the NPC passively mention the small detail. ---
    // BL-014: a scene is recorded from the PLAYER's room, and the engine now drops a named witness its
    // own occupancy places elsewhere (a phantom co-presence). The player witnessing the teller requires
    // genuine co-presence — walk to the teller's room so the scene is legitimately grounded.
    sb.session.movePlayer(sb.session.occupancy()!.get(teller)!);
    // `kind` is omitted on purpose: this is throwaway small talk, not weight-bearing social play —
    // it must still be recorded ("recorded or it didn't happen") and recalled later.
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, teller], content: SMALL_DETAIL });

    // Baseline event count: every later check proves the count only GREW (non-degradation #4 / 0007).
    const earlyEventCount = sb.engine.events.count();

    // --- Drive SUBSTANTIALLY toward LATE game: many weeks of real ceremonies (advanceToFinale
    //     auto-resolves the player's pendings to a crowned winner) PLUS heaps of later social play,
    //     so the small detail is BURIED under masses of intervening memory (the non-degradation
    //     stress). The player witnessed the early scene, so it stays the player's knowledge even
    //     after the season runs on past them. ---
    let buried = 0;
    for (let wk = 0; wk < 40; wk++) {
      const partner = others[wk % others.length]!;
      // Each filler scene is itself recorded + indexed for the partner — these are the later
      // memories the small detail must out-rank for relevance / not be pruned beneath.
      sb.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "strategy",
        content: `Later vote-counting check-in number ${wk}: who is going up, who has the numbers, ` +
          `and where the house is leaning this week — pure game talk, nothing personal.`,
      });
      buried++;
    }
    // …and run the actual season to a crown: weeks of ceremonies/comps/evictions accumulate as
    // recorded beats (a genuinely LATE, full game — the detail is now deep in the past).
    const finale = sb.session.advanceToFinale();
    expect(finale.finished).toBe(true);
    expect(finale.weeks).toBeGreaterThan(1); // a real, multi-week season elapsed

    const lateEventCount = sb.engine.events.count();
    // Non-degradation: the record only GREW; nothing — least of all the early small detail — was pruned.
    expect(lateEventCount).toBeGreaterThan(earlyEventCount + buried);

    // === (1) MCP-accessible "a thing that happened": the PLAYER-CHANNEL read still returns the
    //         recorded scene, content intact / full-fidelity (the specific detail is NOT flattened). ===
    const visible = (await sb.mcp.player.callTool("getVisibleStateFor", {})) as VisibleState;
    const recalledEvent = visible.visibleEvents.find((e) => e.content === SMALL_DETAIL);
    expect(recalledEvent, "the early small-talk scene is still in the player's visible events late-game").toBeTruthy();
    // Byte-identical to what was recorded — the specific life detail survived in FULL, never digested away.
    expect(recalledEvent!.content).toBe(SMALL_DETAIL);
    expect(tokensIn(recalledEvent!.content)).toBe(true);

    // The player-channel read is Vault-free (HARD rule): no hidden event content, no edge numbers.
    const visibleBlob = JSON.stringify(visible);
    expect(visible.visibleEvents.every((e) => !e.hidden)).toBe(true);
    expect(visibleBlob).not.toMatch(/"trust":|"affinity":|"threat":/);

    // === (2) SEMANTIC recall: the engine can recall the memory into the per-turn narration context,
    //         relevance-ranked out of MANY later memories — proving it isn't amnesic. The context is
    //         NOT a substring of the detail, so a hit is genuine semantic relevance. ===
    const recalled = sb.engine.soul.recall(teller, RECALL_CONTEXT, 5);
    const recalledText = recalled.map((m) => m.content).join("\n");
    expect(recalled.some((m) => m.content === SMALL_DETAIL)).toBe(true);
    expect(tokensIn(recalledText)).toBe(true);

    // === Non-degradation + lossless: the recalled memory is BYTE-IDENTICAL to what was recorded. ===
    const recalledMem = recalled.find((m) => m.content === SMALL_DETAIL)!;
    expect(recalledMem.content).toBe(SMALL_DETAIL);

    // seasonRecap is the public ARC (ceremonies/deals) — small talk is correctly NOT a "highlight"
    // there. We assert the contrast so a future change that floods the recap with chatter is caught,
    // and we confirm the recap is Vault-free.
    const recap = (await sb.mcp.player.callTool("seasonRecap", {})) as SeasonRecapView;
    expect(recap.highlights.some((h) => h === SMALL_DETAIL)).toBe(false);
    expect(JSON.stringify(recap)).not.toMatch(/"trust":|"affinity":|"threat":/);

    // === (3) DURABILITY: survives a real save round-trip / restart (the "humans remember" point).
    //         A brand-new registry + store over the SAME data dir is the new-process analogue. ===
    const after = new GameSessionRegistry(new FileSaveStore(dir));
    const sb2 = after.sandboxFor(USER);

    // The event count did not shrink across the restart (non-degradation: superset / monotonic count).
    expect(sb2.engine.events.count()).toBeGreaterThanOrEqual(lateEventCount);

    // MCP read, post-restart: the small detail is STILL "a thing that happened", full-fidelity.
    const visible2 = (await sb2.mcp.player.callTool("getVisibleStateFor", {})) as VisibleState;
    const recalledEvent2 = visible2.visibleEvents.find((e) => e.content === SMALL_DETAIL);
    expect(recalledEvent2, "the small detail is still recallable from MCP after a restart").toBeTruthy();
    expect(recalledEvent2!.content).toBe(SMALL_DETAIL); // byte-identical across the round-trip

    // Soul recall, post-restart: the index re-derives from the persisted mirror, so the memory is
    // STILL semantically recallable (it used to vanish on restore — L27b — the regression guard).
    const recalled2 = sb2.engine.soul.recall(teller, RECALL_CONTEXT, 5);
    expect(recalled2.some((m) => m.content === SMALL_DETAIL)).toBe(true);
    expect(tokensIn(recalled2.map((m) => m.content).join("\n"))).toBe(true);
  });
});
