import { describe, it, expect } from "vitest";
import { recallWitnessedMoments, type RecallCandidate } from "../../src/engine/memoryCallback";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { VisibleStateService } from "../../src/services/VisibleStateService";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { buildSandbox } from "../support/sandbox";
import { PLAYER, npc } from "../../src/domain/ids";
import type { GameEvent } from "../../src/domain/event";

/**
 * Feature #1394 — THE LEAK BOUNDARY TEST (the whole risk of memory callbacks).
 *
 * A recalled moment may reach the player ONLY if the player witnessed it (or it reached them via an
 * 0002 pathway). NEVER Vault content. This proves that structurally: we plant a Vault-only NPC↔NPC
 * scene (hidden, player EXCLUDED from the witness set) that is deliberately MORE relevant to the cue
 * than the legitimate witnessed scene — same houseguest, more shared words — and prove that recall
 * over the player's Vault-free projection can surface the witnessed scene and can NEVER surface the
 * Vault one. The control run over the RAW event store surfaces the sentinel, proving the test is not
 * vacuous: the ONLY thing standing between the player and the secret is reading the Vault-free
 * projection (`VisibleStateService`), which is exactly what the production wiring does (see the
 * registry `setSceneRecall`). Roles only — no names.
 */

const embed = (t: string) => new DeterministicEmbedding().embed(t);

// A cue the scheming secret and the witnessed promise BOTH speak to — so the secret is genuinely the
// closer semantic match (it shares every distinctive token). If recall read the raw store, the secret
// would win; the projection is what keeps it out.
const CUE = "the veto betrayal — writing my name on the block at the ceremony";

/** Stand up a sandbox, plant a matched pair (a Vault-only secret + a witnessed promise) both involving
 *  the same NPC, and return the sentinel that marks the secret + the visible projection over the store. */
function plantMatchedPair() {
  const sb = buildSandbox(7);
  const SECRET = sb.freshSentinel("callback-leak"); // a unique canary that lives ONLY in Vault content

  // (1) A Vault-only NPC↔NPC scene — hidden, witnessSet EXCLUDES the player. Highly relevant to CUE.
  sb.engine.events.record({
    id: "leak:secret", ts: 5000, type: "conversation", hidden: true,
    initiator: npc(2), witnessSet: [npc(2), npc(3)],
    content: `scheming about the veto betrayal — writing your name on the block at the ceremony ${SECRET}`,
  });
  // Mirror it into the Vault too (a real off-screen scene is Vault-sealed), so any Vault read would carry it.
  sb.engine.vault.writeHidden({ id: "leak:secret", kind: "offscreen-event", subject: npc(2),
    content: `scheming about the veto betrayal — writing your name on the block ${SECRET}` });

  // (2) A witnessed player↔NPC scene with the SAME NPC — the legitimate callback (no sentinel).
  const PROMISE = "you swore at the veto ceremony you would never write my name on the block";
  sb.engine.events.record({
    id: "leak:promise", ts: 5001, type: "conversation", hidden: false,
    initiator: PLAYER, witnessSet: [PLAYER, npc(2)], content: PROMISE,
  });

  const visible = new VisibleStateService(sb.engine.events, sb.engine.knowledge);
  return { sb, SECRET, PROMISE, visible };
}

const asCandidate = (e: GameEvent): RecallCandidate =>
  ({ id: e.id, ts: e.ts, content: e.content, initiator: e.initiator, witnessSet: e.witnessSet });

describe("#1394 memory-callback LEAK boundary — recall can never surface Vault content", () => {
  it("recall over the player's Vault-free projection surfaces the witnessed moment, NOT the secret", () => {
    const { sb, SECRET, PROMISE, visible } = plantMatchedPair();

    // THE MANDATED SOURCE: the player's own witness-filtered projection.
    const projection = visible.getVisibleStateFor(PLAYER).visibleEvents.map(asCandidate);
    const res = recallWitnessedMoments({ events: projection, npcIds: [npc(2)], cue: CUE, embed });

    // The witnessed promise IS recalled…
    expect(res.moments).toContain(PROMISE);
    // …and NO recalled moment carries the secret's canary, nor ANY of the sandbox's Vault sentinels.
    const blob = res.moments.join("\n");
    expect(blob).not.toContain(SECRET);
    for (const s of sb.sentinels) expect(blob).not.toContain(s);
  });

  it("CONTROL: the SAME cue over the RAW event store WOULD surface the secret — proving the projection is what saves us", () => {
    const { sb, SECRET } = plantMatchedPair();

    // The raw, unfiltered store (Vault-hidden content included) — the source the mandate forbids.
    const raw = sb.engine.events.queryAll().map(asCandidate);
    const leaked = recallWitnessedMoments({ events: raw, npcIds: [npc(2)], cue: CUE, embed });

    // The secret is the closer match, so reading the raw store LEAKS it (the test is not vacuous).
    expect(leaked.moments.join("\n")).toContain(SECRET);
  });

  it("the visible projection itself never contains any Vault sentinel (defense in depth)", () => {
    const { sb, visible } = plantMatchedPair();
    const blob = JSON.stringify(visible.getVisibleStateFor(PLAYER));
    for (const s of sb.sentinels) expect(blob).not.toContain(s);
  });

  it("the WIRED adapter path (session.recallSceneMemories over the projection) never leaks the secret", () => {
    const { sb, SECRET, PROMISE, visible } = plantMatchedPair();

    // Wire the session EXACTLY as the registry does: the recall closure reads only the visible projection.
    const session = new GameSessionAdapter();
    session.setSceneRecall((npcIds, cue) =>
      recallWitnessedMoments({
        events: visible.getVisibleStateFor(PLAYER).visibleEvents.map(asCandidate),
        npcIds, cue, embed,
      }).moments,
    );

    const view = session.recallSceneMemories({ withIds: [npc(2)], cue: CUE });
    expect(view.moments).toContain(PROMISE);
    const blob = view.moments.join("\n");
    expect(blob).not.toContain(SECRET);
    for (const s of sb.sentinels) expect(blob).not.toContain(s);
  });

  it("an unwired / empty-request session returns { moments: [] } (never throws, never leaks)", () => {
    const session = new GameSessionAdapter();
    expect(session.recallSceneMemories({ withIds: [npc(2)], cue: CUE }).moments).toEqual([]); // unwired
    session.setSceneRecall(() => ["ignored — no npc/cue means we never get here"]);
    expect(session.recallSceneMemories({ withIds: [], cue: CUE }).moments).toEqual([]); // no npc
    expect(session.recallSceneMemories({ withIds: [npc(2)], cue: "  " }).moments).toEqual([]); // no cue
  });
});
