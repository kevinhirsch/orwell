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

describe("#846/#847 — the deep-profile dump row is structured and not duplicated by the threads", () => {
  it("#846 — no `[Hidden side]` row concatenates secrets+goals+weakness into one run-on", () => {
    const sb = liveSandbox("pvr-846", 7);
    const dump = sb.session.producerVaultDump()!;
    const sides = dump.hiddenStory.filter((r) => r.type === "Hidden side");
    expect(sides.length).toBeGreaterThan(0);
    // The defect was ONE row carrying the secrets AND the goals AND the weakness, semicolon-joined.
    for (const s of sides) {
      const isRunOn = /secretly/i.test(s.content) && /real game/i.test(s.content) && /blind spot/i.test(s.content);
      expect(isRunOn, `Hidden side row is a multi-field run-on: ${s.content}`).toBe(false);
    }
    // The deep profile's unique, non-thread field IS surfaced: the houseguest's day-one read of the player.
    const dayOne = sides.filter((s) => /day-one read of you:/i.test(s.content));
    expect(dayOne.length).toBeGreaterThan(0);
    for (const d of dayOne) expect(d.content).toMatch(/\S+ — day-one read of you: \S/);
  });

  it("#847 — a deep-profile secret renders ONCE (in the threads), not also in a Hidden side row", () => {
    const sb = liveSandbox("pvr-847", 7);
    const dump = sb.session.producerVaultDump()!;
    const threadText = dump.hiddenStory.filter((r) => r.type === "Secret thread").map((r) => r.content).join("\n");
    const sideText = dump.hiddenStory.filter((r) => r.type === "Hidden side").map((r) => r.content).join("\n");
    expect(threadText.length).toBeGreaterThan(0);
    // Take a distinctive multi-word fragment from a secret thread; it must NOT also appear among the
    // Hidden side rows (the old blob double-printed it). Probe a few threads to avoid a degenerate pick.
    const threads = dump.hiddenStory.filter((r) => r.type === "Secret thread");
    let probed = 0;
    for (const t of threads) {
      const tail = t.content.split("—").slice(1).join("—").trim(); // the prose after the leading "<Name> —"
      const frag = tail.replace(/\(.*?\)/g, "").trim().slice(0, 30);
      if (frag.length < 12) continue;
      probed++;
      expect(sideText.includes(frag), `secret fragment double-printed in a Hidden side row: ${frag}`).toBe(false);
    }
    expect(probed, "no secret-thread fragment was substantial enough to probe").toBeGreaterThan(0);
  });
});

describe("#841/#842 — the dump dedupes byte-identical rows and coalesces symmetric pairs", () => {
  /** Plant a hidden, player-excluded off-screen scene (kept verbatim so the render is predictable). */
  function plantHidden(sb: ReturnType<GameSessionRegistry["sandboxFor"]>, id: string, ts: number, a: string, b: string, content: string): void {
    sb.engine.events.record({ id, ts, type: "conversation", initiator: a, witnessSet: [a, b], hidden: true, content });
  }

  it("#841 — two byte-identical hidden rows collapse to one", () => {
    const sb = liveSandbox("pvr-841", 7);
    plantHidden(sb, "dup-a", 9_600_001, npc(1), npc(2), `${npc(1)} bonded with ${npc(2)}`);
    plantHidden(sb, "dup-b", 9_600_002, npc(1), npc(2), `${npc(1)} bonded with ${npc(2)}`); // identical content
    const dump = sb.session.producerVaultDump()!;
    // No `{type, content}` appears more than once anywhere in the dump.
    const seen = new Map<string, number>();
    for (const r of dump.hiddenStory) { const k = `${r.type}|${r.content}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
    expect([...seen.values()].filter((n) => n > 1)).toHaveLength(0);
  });

  it("#842 — a symmetric `A clashed with B` + `B clashed with A` coalesces to one entry", () => {
    const sb = liveSandbox("pvr-842", 7);
    plantHidden(sb, "sym-a", 9_700_001, npc(1), npc(2), `${npc(1)} clashed with ${npc(2)}`);
    plantHidden(sb, "sym-b", 9_700_002, npc(2), npc(1), `${npc(2)} clashed with ${npc(1)}`); // the mirror
    const dump = sb.session.producerVaultDump()!;
    const clashes = dump.hiddenStory.filter((r) => /clashed with/.test(r.content));
    expect(clashes).toHaveLength(1); // the two directions are ONE mutual scene
    expect(clashes[0]!.content).not.toMatch(/\bnpc:\d+\b/); // names resolved
  });

  it("#842 — a symmetric pair coalesces even with different flavor tails", () => {
    const sb = liveSandbox("pvr-842b", 7);
    plantHidden(sb, "tail-a", 9_800_001, npc(1), npc(2), `${npc(1)} clashed with ${npc(2)} — over the nominations`);
    plantHidden(sb, "tail-b", 9_800_002, npc(2), npc(1), `${npc(2)} clashed with ${npc(1)} — about a broken promise`);
    const dump = sb.session.producerVaultDump()!;
    expect(dump.hiddenStory.filter((r) => /clashed with/.test(r.content))).toHaveLength(1);
  });

  it("does NOT coalesce a DIFFERENT pair or a different interaction (no over-collapse)", () => {
    const sb = liveSandbox("pvr-842c", 7);
    plantHidden(sb, "p1", 9_900_001, npc(1), npc(2), `${npc(1)} clashed with ${npc(2)}`);
    plantHidden(sb, "p2", 9_900_002, npc(3), npc(4), `${npc(3)} clashed with ${npc(4)}`); // a DIFFERENT pair
    plantHidden(sb, "p3", 9_900_003, npc(1), npc(2), `${npc(1)} bonded with ${npc(2)}`);   // same pair, different verb
    const dump = sb.session.producerVaultDump()!;
    expect(dump.hiddenStory.filter((r) => /clashed with/.test(r.content))).toHaveLength(2); // two distinct conflicts
    expect(dump.hiddenStory.filter((r) => /bonded with/.test(r.content)).length).toBeGreaterThanOrEqual(1);
  });
});

describe("#852 — dump rows carry a time marker and come out chronologically", () => {
  it("surfaces an ascending `ts` on the live hidden rows and orders the dump by it", () => {
    const sb = liveSandbox("pvr-852", 7);
    // Plant three hidden scenes IN ORDER. The EventStore is the monotonic-tick authority, so insertion
    // order IS chronological order — assert the dump preserves it and exposes the marker.
    const tag = "PVR852";
    sb.engine.events.record({ id: "c1", ts: 9_990_001, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: `${tag}-first a quiet aside` });
    sb.engine.events.record({ id: "c2", ts: 9_990_002, type: "conversation", initiator: npc(3), witnessSet: [npc(3), npc(4)], hidden: true, content: `${tag}-second a hallway whisper` });
    sb.engine.events.record({ id: "c3", ts: 9_990_003, type: "conversation", initiator: npc(5), witnessSet: [npc(5), npc(6)], hidden: true, content: `${tag}-third a late-night plan` });
    const dump = sb.session.producerVaultDump()!;
    // every live row exposes a numeric ts marker, and they are globally non-decreasing across the dump
    const withTs = dump.hiddenStory.filter((r) => typeof r.ts === "number");
    expect(withTs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < withTs.length; i++) expect(withTs[i]!.ts!).toBeGreaterThanOrEqual(withTs[i - 1]!.ts!);
    // our three planted scenes appear in the order they happened
    const planted = dump.hiddenStory.filter((r) => r.content.includes(tag)).map((r) => r.content.match(/PVR852-(\w+)/)![1]);
    expect(planted).toEqual(["first", "second", "third"]);
    // pre-season setup rows (threads / ties / day-one reads) carry NO ts and sort to the front
    const firstLiveIdx = dump.hiddenStory.findIndex((r) => typeof r.ts === "number");
    for (let i = 0; i < firstLiveIdx; i++) expect(dump.hiddenStory[i]!.ts).toBeUndefined();
  });
});
