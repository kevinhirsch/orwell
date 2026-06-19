import { describe, it, expect } from "vitest";
import { newGameState, advanceGame } from "../../src/engine/gameProgression";
import { deepCopy, isSuperset, counts, countsNonDecreasing } from "../../src/domain/saveState";
import type { GameState } from "../../src/domain/saveState";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * R3 — the O(Δ) non-degradation fast path. The append-only event log is the dominant accumulator, so
 * re-`sameJson`-ing the whole prefix every commit is the late-season latency cost. `isSuperset(...,
 * { trustEventPrefix: true })` trusts the immutable, already-verified event prefix and checks only that
 * it was not truncated and its boundary is intact (O(Δ)). The guarantees this MUST keep:
 *   - a net DROP of anything is still caught (countsNonDecreasing, every commit);
 *   - a corrupted prefix BOUNDARY is caught (the spot-check);
 *   - EVERY non-event dimension (knowledge, suspicions, souls, the byte-stable character, relationships)
 *     stays FULLY verified — the fast path only relaxes the EVENT-content re-scan.
 * The one thing it trusts — a MIDDLE event's body rewritten in place at equal length (impossible under
 * the append-only contract) — is still caught by the FULL (untrusted-prefix) path, which the orchestrator
 * runs on a user's first commit and at least every R3_FULL_CHECK_EVERY commits as cheap belt-and-suspenders.
 */

function baseState(seed = 3): GameState {
  const rng = new SeededRandom(seed);
  const state = newGameState(rng);
  for (let k = 0; k < 8; k++) advanceGame(state, rng, `r3-${k}`);
  state.suspicions = [{ entity: "player", suspicion: { id: "s-1", content: "a hunch", ts: 1 } }];
  state.vaultIds = ["vault-1", "vault-2"];
  return state;
}

describe("R3 — isSuperset trustEventPrefix fast path", () => {
  it("the fixture has a real event MIDDLE (so the boundary vs middle distinction is meaningful)", () => {
    expect(baseState().events.length).toBeGreaterThanOrEqual(3);
  });

  it("pure accumulation passes in the fast path (not fail-always)", () => {
    const b = baseState();
    const grown = deepCopy(b);
    advanceGame(grown, new SeededRandom(99), "r3-grow");
    expect(isSuperset(grown, b, { trustEventPrefix: true })).toBe(true);
    expect(countsNonDecreasing(counts(grown), counts(b))).toBe(true);
  });

  it("a DROPPED event is still caught (truncated prefix — length) in the fast path", () => {
    const b = baseState();
    const m = deepCopy(b); m.events.splice(0, 1);
    expect(isSuperset(m, b, { trustEventPrefix: true })).toBe(false);
    // and the independent counts guard catches it regardless
    expect(countsNonDecreasing(counts(m), counts(b))).toBe(false);
  });

  it("a corrupted prefix BOUNDARY event (start OR end) is caught by the spot-check", () => {
    const b = baseState();
    const mStart = deepCopy(b); (mStart.events[0] as { content: string }).content += " X";
    expect(isSuperset(mStart, b, { trustEventPrefix: true })).toBe(false);
    const mEnd = deepCopy(b);
    (mEnd.events[mEnd.events.length - 1] as { content: string }).content += " X";
    expect(isSuperset(mEnd, b, { trustEventPrefix: true })).toBe(false);
  });

  it("a MIDDLE event mutated in place is TRUSTED by the fast path but CAUGHT by the full path (the tradeoff)", () => {
    const b = baseState();
    const mid = Math.floor(b.events.length / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(b.events.length - 1);
    const m = deepCopy(b);
    (m.events[mid] as { content: string }).content += " (rewritten)"; // same length, a middle record
    // the fast path trusts the immutable append-only prefix (this mutation is impossible by contract)…
    expect(isSuperset(m, b, { trustEventPrefix: true })).toBe(true);
    // …and the FULL (untrusted-prefix) path — which the orchestrator runs on the first commit and
    // periodically thereafter — still catches it (fail-closed).
    expect(isSuperset(m, b)).toBe(false);
  });

  it("every NON-event degradation is still caught in the fast path (those dimensions stay full)", () => {
    const b = baseState();
    const dropRel = deepCopy(b); dropRel.relationships.splice(0, 1);
    expect(isSuperset(dropRel, b, { trustEventPrefix: true })).toBe(false);

    const editChar = deepCopy(b);
    const cid = Object.keys(editChar.characters)[0]!;
    editChar.characters[cid]!.background = "retconned";
    expect(isSuperset(editChar, b, { trustEventPrefix: true })).toBe(false);

    const dropSusp = deepCopy(b); dropSusp.suspicions!.splice(0, 1);
    expect(isSuperset(dropSusp, b, { trustEventPrefix: true })).toBe(false);

    const dropVault = deepCopy(b); dropVault.vaultIds!.splice(0, 1);
    expect(isSuperset(dropVault, b, { trustEventPrefix: true })).toBe(false);

    const sid = Object.keys(b.souls).find((id) => b.souls[id]!.memory.length > 0);
    if (sid) {
      const truncSoul = deepCopy(b); truncSoul.souls[sid]!.memory.pop();
      expect(isSuperset(truncSoul, b, { trustEventPrefix: true })).toBe(false);
      const rewriteSoul = deepCopy(b); rewriteSoul.souls[sid]!.memory[0] = "memory-hole";
      expect(isSuperset(rewriteSoul, b, { trustEventPrefix: true })).toBe(false);
    }
  });
});
