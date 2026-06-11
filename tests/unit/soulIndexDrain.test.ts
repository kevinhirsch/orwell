import { describe, it, expect } from "vitest";
import { SoulStore } from "../../src/adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { npc } from "../../src/domain/ids";

/**
 * Lane G8 — the soul-seeding batch must not pin the event loop. The real embedder
 * (ADR 0004) blocks the loop per call, so `recordToSoul` defers the DERIVED vector
 * indexing to a one-embed-per-macrotask drain; the AUTHORITATIVE soul (narrative +
 * memories) still updates synchronously, and `recall` flushes its houseguest's
 * pending queue first so recall semantics are unchanged. Roles only — no names.
 */

/** A counting embed over the deterministic vectors (the test adapter's space). */
function countingEmbed(): { calls: () => number; embed: (t: string) => number[] } {
  const inner = new DeterministicEmbedding();
  let n = 0;
  return { calls: () => n, embed: (t: string) => { n++; return inner.embed(t); } };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const A = npc(1);
const B = npc(2);

describe("G8 — SoulStore spaces its sync embeds (the loop breathes during a seeding batch)", () => {
  it("recordToSoul is synchronous for the AUTHORITATIVE soul but embeds nothing inline", () => {
    const e = countingEmbed();
    const s = new SoulStore(e.embed);
    for (let i = 0; i < 8; i++) s.recordToSoul(A, `a consequential beat ${i}`);
    expect(s.soulOf(A).memories).toHaveLength(8); // the soul itself deepened synchronously (0007)
    expect(s.soulOf(A).narrative.length).toBeGreaterThan(0);
    expect(e.calls()).toBe(0); // the batch pinned the loop with ZERO inline embeds
  });

  it("the queue drains in the background, one embed per macrotask (the loop yields between calls)", async () => {
    const e = countingEmbed();
    const s = new SoulStore(e.embed);
    for (let i = 0; i < 5; i++) s.recordToSoul(A, `beat ${i}`);
    expect(e.calls()).toBe(0);
    await tick(); // each macrotask indexes exactly one memory — the spacing IS the fix
    expect(e.calls()).toBe(1);
    await tick();
    expect(e.calls()).toBe(2);
    for (let i = 0; i < 10; i++) await tick(); // the drain completes without any recall
    expect(e.calls()).toBe(5);
  });

  it("recall immediately after a batch is COMPLETE (it flushes that houseguest's pending queue)", () => {
    const e = countingEmbed();
    const s = new SoulStore(e.embed);
    s.recordToSoul(A, "a brutal veto betrayal that cut deep");
    for (let i = 0; i < 6; i++) s.recordToSoul(A, `trivial chat about breakfast cereal ${i}`);
    const r = s.recall(A, "the veto betrayal", 1); // no macrotask has run yet
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toContain("veto betrayal");
    expect(e.calls()).toBe(8); // 7 flushed memories + 1 context embed — all on the sync seam
  });

  it("recall flushes ONLY its own houseguest; the rest of the batch keeps draining in the background", async () => {
    const e = countingEmbed();
    const s = new SoulStore(e.embed);
    s.recordToSoul(A, "an alliance whisper");
    s.recordToSoul(A, "a kitchen confrontation");
    s.recordToSoul(B, "a private scheme");
    s.recordToSoul(B, "a thrown competition");
    s.recordToSoul(B, "a goodbye grudge");
    expect(s.recall(A, "alliance", 1)).toHaveLength(1);
    expect(e.calls()).toBe(3); // A's two memories + the context — B's three stay queued
    for (let i = 0; i < 10; i++) await tick();
    expect(e.calls()).toBe(6); // …and drain without ever being forced inline
    expect(s.recall(B, "scheme", 1)[0]!.content).toContain("scheme");
  });

  it("a failing embed degrades only that memory's recall — the drain and the soul survive", async () => {
    let n = 0;
    const inner = new DeterministicEmbedding();
    const s = new SoulStore((t) => {
      n++;
      if (n === 1) throw new Error("model hiccup");
      return inner.embed(t);
    });
    s.recordToSoul(A, "the lost memory");
    s.recordToSoul(A, "the surviving veto grudge");
    for (let i = 0; i < 10; i++) await tick();
    expect(s.soulOf(A).memories).toHaveLength(2); // the authoritative soul never thinned (0007)
    const r = s.recall(A, "veto grudge", 2);
    expect(r.map((m) => m.content)).toContain("the surviving veto grudge");
  });
});
