import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { npc, PLAYER } from "../../src/domain/ids";

/**
 * producerVault DUMP RENDERING (audit #841–#852) — the owner-ruled DEBUG live-Vault unseal must render
 * its rows as readable, humanized prose, not raw machine breadcrumbs/blobs. These tests pin the
 * RENDER side ONLY — they never change what the engine records or rolls (calibration-neutral). HARD
 * rule: roles only — the names below are obvious placeholders, never canonical personas.
 *
 * Each `it` targets one audit item:
 *  - #843 a gossip/surfacing row shows the joined belief, not the `reaches <to>` breadcrumb;
 *  - #846 a deep-profile `[Hidden side]` row renders as labeled sub-bullets, not one semicolon run-on;
 *  - #847 the deep-profile secret is not ALSO duplicated by the derived secret threads;
 *  - #841/#842 byte-identical rows collapse, and a symmetric A↔B conflict coalesces to one row;
 *  - #852 dump rows carry a time marker and come out in chronological order.
 */

function liveSandbox(user: string, seed: number): ReturnType<GameSessionRegistry["sandboxFor"]> {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return sb;
}

/** Lowercase, whitespace-collapsed text of the whole hidden story (for substring assertions). */
function storyText(dump: { hiddenStory: Array<{ type: string; content: string }> }): string {
  return dump.hiddenStory.map((r) => `${r.type} ${r.content}`).join(" \n ");
}

describe("#843 — a gossip/surfacing dump row shows the real belief, not the breadcrumb", () => {
  it("renders the joined KnowledgeFact content, never `gossip <pathway> reaches <to>`", () => {
    const sb = liveSandbox("pvr-843", 7);
    // Two NPCs exist on the live roster; lodge a hidden NPC↔NPC rumor (witness set excludes the player).
    const belief = "SENTINEL-belief-the-floater-is-flipping-this-week";
    sb.engine.knowledge.transmitGossip(
      npc(1), npc(2),
      { content: belief, factId: "fact:843", originalContent: belief, confidence: 0.7, hops: 1, distortion: 1, source: npc(1) },
      "told-by:" + npc(1),
    );
    const dump = sb.session.producerVaultDump()!;
    const text = storyText(dump);
    // The dump shows the BELIEF, never the internal breadcrumb or its raw `reaches <id>` plumbing.
    expect(text).toContain(belief);
    expect(text).not.toMatch(/reaches\s+npc:\d+/);
    expect(text).not.toMatch(/\bgossip\s+told-by\b/);
    expect(text).not.toMatch(/\bnpc:\d+\b/);
  });

  it("renders a surfacing row as the surfaced fact, not `surfaced to <entity> via <pathway>`", () => {
    const sb = liveSandbox("pvr-843b", 11);
    // A surfacing must be content-anchored: seed an NPC's origin belief, then surface it (NPC→NPC, hidden).
    const fact = "SENTINEL-surfaced-an-alliance-of-three-is-forming";
    sb.engine.knowledge.seedBelief(
      npc(1), { content: fact, factId: "fact:843b", originalContent: fact, confidence: 0.9, hops: 0, distortion: 0, source: npc(1) }, "origin",
    );
    const surfaced = sb.engine.knowledge.surfaceInformationTo(npc(2), { content: fact }, "told-by:" + npc(1));
    expect(surfaced).not.toBeNull(); // anchored → a real surfacing event was recorded
    const text = storyText(sb.session.producerVaultDump()!);
    expect(text).toContain(fact);
    expect(text).not.toMatch(/surfaced to .* via/);
    expect(text).not.toMatch(/\bnpc:\d+\b/);
  });
});
