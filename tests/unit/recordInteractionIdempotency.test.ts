import { describe, it, expect } from "vitest";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { StaleBeatError } from "../../src/domain/errors";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * A10 / #591 / R1c — the at-most-once idempotency key on `recordInteraction`, closing the residual
 * DOUBLE-APPLY under sustained two-window concurrency.
 *
 * THE BUG this proves fixed: the FE re-drives a fold-bearing scene after a stale-409 — the single
 * retry of #591 PLUS the CON-11 deferred-fold queue. `expectedBeatSeq` (CAS-before-write) makes ONE
 * retry safe, but under sustained two-window concurrency two turns can drain the SAME deferred fold
 * and re-drive it. A 409 there is AMBIGUOUS ("the peer already applied this" vs "the board moved on"),
 * so the FE conservatively re-queues it and the scene's consequence folds TWICE — the hidden
 * relationship layer moves twice (a non-degradation / anti-sycophancy break). CAS cannot close this:
 * both re-drives carry a valid, freshly-reconciled token, so both pass `guardBeatSeq`.
 *
 * THE FIX: a stable caller-minted `idempotencyKey`. A repeat key returns the prior `eventId` WITHOUT
 * re-recording or re-folding — checked BEFORE `guardBeatSeq`, so it is a no-op SUCCESS even against a
 * board that has since moved (exactly the re-driven/re-queued case). Roles only.
 */
function mk() {
  const events = new InMemoryEventStore();
  const rel = new RelationshipModel(0.5);
  const cmd = new EngineCommandsAdapter(
    events, new InMemoryKnowledgeService(new InMemoryEventStore()), rel, new SeededRandom(7),
  );
  cmd.setLivingProvider(() => [npc(1), npc(2)]);
  let beat = 0;
  cmd.setBeatSeqProvider(() => beat);
  cmd.setBoardProvider(() => ({ beatSeq: beat }));
  const edge = () => ({ ...rel.edge(npc(1), PLAYER) });
  return { events, rel, cmd, edge, setBeat: (n: number) => { beat = n; } };
}

const scene = (key?: string, expectedBeatSeq?: number) => ({
  initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "a quiet bond", kind: "bonding",
  ...(key !== undefined ? { idempotencyKey: key } : {}),
  ...(expectedBeatSeq !== undefined ? { expectedBeatSeq } : {}),
});

describe("A10/#591 — recordInteraction is at-most-once per idempotencyKey", () => {
  it("a REPEAT key returns the prior eventId and folds exactly ONCE (no double-apply)", () => {
    const { cmd, edge, events } = mk();
    const before = edge();

    const first = cmd.recordInteraction(scene("K1"));
    const afterOne = edge();
    expect(afterOne).not.toEqual(before);            // the fold landed once
    const eventsAfterOne = events.count();

    // The re-drive: the CON-11 deferred queue (or a concurrent drain) fires the SAME scene again with
    // the SAME key. It must NOT fold again.
    const second = cmd.recordInteraction(scene("K1"));
    expect(second.eventId).toBe(first.eventId);       // same recording, not a new one
    expect(edge()).toEqual(afterOne);                 // the hidden layer did NOT move a second time
    expect(events.count()).toBe(eventsAfterOne);      // no second event recorded
  });

  it("WITHOUT a key the same second call DOES fold again — proving the key is what prevents it", () => {
    const { cmd, edge } = mk();
    cmd.recordInteraction(scene());                   // no key
    const afterOne = edge();
    cmd.recordInteraction(scene());                   // no key — the legacy double-apply
    expect(edge()).not.toEqual(afterOne);             // folded twice (byte-identical to pre-A10 behavior)
  });

  it("the repeat short-circuits BEFORE the CAS guard — a stale re-drive returns cleanly, never a 409", () => {
    const { cmd, edge, setBeat } = mk();
    const first = cmd.recordInteraction(scene("K2", 0)); // board at 0, folds, stores K2
    const afterOne = edge();

    // The board has since moved (a concurrent progression). The FE's re-queued drain re-attaches its
    // ORIGINAL (now stale) token. A keyless stale call would 409; the keyed duplicate returns the prior
    // eventId with NO throw and NO second fold — which is exactly why the FE never re-queues it again.
    setBeat(5);
    let out!: { eventId: string };
    expect(() => { out = cmd.recordInteraction(scene("K2", 0)); }).not.toThrow();
    expect(out.eventId).toBe(first.eventId);
    expect(edge()).toEqual(afterOne);
  });

  it("a genuinely NEW key still folds (different scene → its own fold and eventId)", () => {
    const { cmd, edge } = mk();
    const a = cmd.recordInteraction(scene("K3"));
    const afterA = edge();
    const b = cmd.recordInteraction(scene("K4"));      // a distinct scene, distinct key
    expect(b.eventId).not.toBe(a.eventId);
    expect(edge()).not.toEqual(afterA);                // it folded (as a real second scene should)
  });

  it("a FIRST call with a fresh key against a stale board still 409s (the CAS guard is intact)", () => {
    const { cmd, setBeat } = mk();
    setBeat(9);
    // A brand-new key that the ledger has never seen must NOT bypass the CAS guard — only a REPEAT
    // key short-circuits. This proves the idempotency check didn't weaken stale-write protection.
    expect(() => cmd.recordInteraction(scene("neverSeen", 2))).toThrow(StaleBeatError);
  });
});
