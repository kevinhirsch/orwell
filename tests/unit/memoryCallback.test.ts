import { describe, it, expect } from "vitest";
import { recallWitnessedMoments, type RecallCandidate } from "../../src/engine/memoryCallback";
import { MEMORY_CALLBACK } from "../../src/engine/memoryCallbackConstants";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature #1394 — the pure recall mechanics: filtering to the scene's NPC, K + relevance threshold +
 * token-budget caps, and the byte-identical floor (absent relevant history ⇒ no moments). Roles only,
 * no names. The Vault-Wall proof is a separate file (`memoryCallbackLeak.test.ts`) that drives the real
 * player projection; here we exercise the ranking maths with a controllable embed.
 */

// A controllable, exact embed over three orthogonal topic axes, so cosine is precisely predictable
// (a hash-based bag-of-words could give a tiny collision score that muddies an on-the-threshold test).
const topicEmbed = (text: string): number[] => {
  const t = text.toLowerCase();
  return [
    t.includes("veto") ? 1 : 0,
    t.includes("cook") ? 1 : 0,
    t.includes("weather") ? 1 : 0,
  ];
};

let ts = 0;
function witnessed(content: string, withNpc = npc(1)): RecallCandidate {
  // A player-witnessed player↔NPC scene: the player + the NPC are both in the witness set.
  return { id: `evt:${++ts}`, ts, content, initiator: PLAYER, witnessSet: [PLAYER, withNpc] };
}

describe("#1394 recallWitnessedMoments — floor contract (absence is not a failure)", () => {
  it("no cue ⇒ no moments", () => {
    const events = [witnessed("we talked about the veto plan")];
    expect(recallWitnessedMoments({ events, npcIds: [npc(1)], cue: "", embed: topicEmbed }).moments).toEqual([]);
    expect(recallWitnessedMoments({ events, npcIds: [npc(1)], cue: "   ", embed: topicEmbed }).moments).toEqual([]);
  });

  it("no NPC in the scene ⇒ no moments", () => {
    const events = [witnessed("we talked about the veto plan")];
    expect(recallWitnessedMoments({ events, npcIds: [], cue: "veto", embed: topicEmbed }).moments).toEqual([]);
  });

  it("no history at all ⇒ no moments (the fresh-game floor)", () => {
    expect(recallWitnessedMoments({ events: [], npcIds: [npc(1)], cue: "veto", embed: topicEmbed }).moments).toEqual([]);
  });

  it("history exists but NONE involves the scene's NPC ⇒ no moments", () => {
    // Every witnessed event is with npc(1); the scene is with npc(2) → no candidate involves npc(2).
    const events = [witnessed("we talked about the veto plan", npc(1))];
    expect(recallWitnessedMoments({ events, npcIds: [npc(2)], cue: "veto", embed: topicEmbed }).moments).toEqual([]);
  });

  it("history exists for the NPC but NONE is relevant to the cue ⇒ no moments (threshold floor)", () => {
    const events = [witnessed("we cooked breakfast together", npc(1))]; // [0,1,0]
    // cue is about the veto [1,0,0] → cosine 0 < minScore → excluded → recall stays silent.
    expect(recallWitnessedMoments({ events, npcIds: [npc(1)], cue: "veto plan", embed: topicEmbed }).moments).toEqual([]);
  });
});

describe("#1394 recallWitnessedMoments — retrieval + scoping", () => {
  it("surfaces the relevant witnessed moment involving the NPC, not the irrelevant one", () => {
    const relevant = witnessed("you swore on the veto you'd never write my name", npc(1)); // [1,0,0]
    const irrelevant = witnessed("we cooked a big breakfast in the kitchen", npc(1)); // [0,1,0]
    const res = recallWitnessedMoments({
      events: [irrelevant, relevant], npcIds: [npc(1)], cue: "the veto vote", embed: topicEmbed,
    });
    expect(res.moments).toEqual([relevant.content]);
  });

  it("scopes to the scene's NPC — a relevant moment with a DIFFERENT NPC is not recalled", () => {
    const withNpc1 = witnessed("veto talk with the first ally", npc(1)); // relevant, but npc(1)
    const withNpc2 = witnessed("veto talk with the second ally", npc(2)); // relevant, npc(2)
    const res = recallWitnessedMoments({
      events: [withNpc1, withNpc2], npcIds: [npc(2)], cue: "veto", embed: topicEmbed,
    });
    expect(res.moments).toEqual([withNpc2.content]);
  });

  it("matches an event where the NPC is the INITIATOR (not just a witness)", () => {
    const npcInitiated: RecallCandidate = {
      id: "evt:init", ts: ++ts, content: "the ally cornered you about the veto",
      initiator: npc(3), witnessSet: [PLAYER, npc(3)],
    };
    const res = recallWitnessedMoments({
      events: [npcInitiated], npcIds: [npc(3)], cue: "veto", embed: topicEmbed,
    });
    expect(res.moments).toEqual([npcInitiated.content]);
  });
});

describe("#1394 recallWitnessedMoments — K + token-budget caps", () => {
  it("returns AT MOST K moments (issue #1394: 1–2)", () => {
    const events = Array.from({ length: 5 }, (_, i) => witnessed(`veto scene number ${i}`, npc(1)));
    const res = recallWitnessedMoments({ events, npcIds: [npc(1)], cue: "veto", embed: topicEmbed });
    expect(res.moments.length).toBeGreaterThan(0);
    expect(res.moments.length).toBeLessThanOrEqual(MEMORY_CALLBACK.k);
    expect(MEMORY_CALLBACK.k).toBeLessThanOrEqual(2);
  });

  it("respects a config override of k", () => {
    const events = Array.from({ length: 4 }, (_, i) => witnessed(`veto scene ${i}`, npc(1)));
    const res = recallWitnessedMoments({
      events, npcIds: [npc(1)], cue: "veto", embed: topicEmbed, config: { k: 1 },
    });
    expect(res.moments.length).toBe(1);
  });

  it("clips each moment to the per-moment character cap (with an ellipsis)", () => {
    const long = "veto " + "x".repeat(1000);
    const res = recallWitnessedMoments({
      events: [witnessed(long, npc(1))], npcIds: [npc(1)], cue: "veto", embed: topicEmbed, config: { k: 1 },
    });
    expect(res.moments).toHaveLength(1);
    expect(res.moments[0]!.length).toBeLessThanOrEqual(MEMORY_CALLBACK.maxCharsPerMoment);
    expect(res.moments[0]!.endsWith("…")).toBe(true);
  });

  it("enforces the TOTAL character budget across all recalled moments", () => {
    // Two long relevant moments; the total cap forbids both fitting → the block stays bounded.
    const a = witnessed("veto " + "a".repeat(300), npc(1));
    const b = witnessed("veto " + "b".repeat(300), npc(1));
    const res = recallWitnessedMoments({
      events: [a, b], npcIds: [npc(1)], cue: "veto", embed: topicEmbed,
      config: { k: 2, maxCharsPerMoment: 300, maxCharsTotal: 320 },
    });
    const total = res.moments.join("").length;
    expect(total).toBeLessThanOrEqual(320);
    // The single most-relevant moment always survives (it alone fits the per-moment clip).
    expect(res.moments.length).toBeGreaterThanOrEqual(1);
  });
});

describe("#1394 recallWitnessedMoments — works with the real deterministic embedder", () => {
  it("ranks a topically-matching witnessed moment above an unrelated one (bag-of-words cosine)", () => {
    const embed = (t: string) => new DeterministicEmbedding().embed(t);
    let n = 0;
    const mk = (content: string): RecallCandidate =>
      ({ id: `d:${++n}`, ts: n, content, initiator: PLAYER, witnessSet: [PLAYER, npc(1)] });
    const relevant = mk("you promised at the nomination ceremony you would never target me for eviction");
    const unrelated = mk("we split a snack and laughed about a silly story from home");
    const res = recallWitnessedMoments({
      events: [unrelated, relevant], npcIds: [npc(1)],
      cue: "are you going to target me for eviction at the nomination ceremony", embed, config: { k: 1 },
    });
    expect(res.moments).toEqual([relevant.content]);
  });
});
