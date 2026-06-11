import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { newGameState, advanceGame } from "../../src/engine/gameProgression";
import { deepCopy, isSuperset, counts, countsNonDecreasing } from "../../src/domain/saveState";
import type { GameState } from "../../src/domain/saveState";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * Audit C4 — the fail-closed checkpoint must see EVERY class of degradation.
 * `isSuperset` used to compare identity only: a truncated event body, a distorted knowledge
 * fact, an edited character, a reordered soul memory — all passed because the ids survived,
 * and suspicions + Vault records were not in the projection at all. Property: ANY single
 * mutated or dropped persisted item makes the checkpoint math (`isSuperset` +
 * `countsNonDecreasing`) refuse the candidate.
 */

function baseState(seed: number): GameState {
  const rng = new SeededRandom(seed);
  const state = newGameState(rng);
  for (let k = 0; k < 8; k++) advanceGame(state, rng, `c4-${k}`);
  // The progression fixture predates the C4 projection terms — attach the layers it omits
  // (roles only: the player and generic npc ids).
  state.suspicions = [
    { entity: "player", suspicion: { id: "s-1", content: "suspects an alliance upstairs", ts: 1 } },
    { entity: "npc:1", suspicion: { id: "s-2", content: "suspects the player threw the comp", ts: 2 } },
  ];
  state.vaultIds = ["vault-1", "vault-2", "vault-3"];
  return state;
}

type Mutator = { name: string; apply: (s: GameState) => boolean };

const firstSoulWith = (s: GameState, pred: (soul: GameState["souls"][string]) => boolean): string | undefined =>
  Object.keys(s.souls).find((id) => pred(s.souls[id]!));

/** Each mutator returns true if it could apply (the state had such an item to degrade). */
const MUTATORS: Mutator[] = [
  { name: "drop an event", apply: (s) => s.events.length > 0 && (s.events.splice(0, 1), true) },
  {
    name: "truncate an event's content",
    apply: (s) => {
      const e = s.events.find((ev) => ev.content.length > 1);
      if (!e) return false;
      (e as { content: string }).content = e.content.slice(0, 1);
      return true;
    },
  },
  {
    name: "shrink an event's witness set",
    apply: (s) => {
      const e = s.events.find((ev) => ev.witnessSet.length > 0);
      if (!e) return false;
      (e as { witnessSet: readonly string[] }).witnessSet = e.witnessSet.slice(1);
      return true;
    },
  },
  { name: "drop a knowledge fact", apply: (s) => s.knowledge.length > 0 && (s.knowledge.splice(0, 1), true) },
  {
    name: "distort a knowledge fact's content",
    apply: (s) => {
      const k = s.knowledge[0];
      if (!k) return false;
      k.fact.content = `${k.fact.content} (rewritten)`;
      return true;
    },
  },
  { name: "drop a suspicion", apply: (s) => (s.suspicions ?? []).length > 0 && (s.suspicions!.splice(0, 1), true) },
  {
    name: "rewrite a suspicion",
    apply: (s) => {
      const sus = s.suspicions?.[0];
      if (!sus) return false;
      sus.suspicion.content = "softened hunch";
      return true;
    },
  },
  { name: "drop a Vault record id", apply: (s) => (s.vaultIds ?? []).length > 0 && (s.vaultIds!.splice(0, 1), true) },
  { name: "drop a relationship edge", apply: (s) => s.relationships.length > 0 && (s.relationships.splice(0, 1), true) },
  {
    name: "edit a static character",
    apply: (s) => {
      const id = Object.keys(s.characters)[0];
      if (!id) return false;
      s.characters[id]!.background = "retconned";
      return true;
    },
  },
  {
    name: "drop a character",
    apply: (s) => {
      const id = Object.keys(s.characters)[0];
      if (!id) return false;
      delete s.characters[id];
      return true;
    },
  },
  {
    name: "truncate a soul's memory",
    apply: (s) => {
      const id = firstSoulWith(s, (soul) => soul.memory.length > 0);
      if (!id) return false;
      s.souls[id]!.memory.pop();
      return true;
    },
  },
  {
    name: "rewrite a soul memory in place",
    apply: (s) => {
      const id = firstSoulWith(s, (soul) => soul.memory.length > 0);
      if (!id) return false;
      s.souls[id]!.memory[0] = "memory-hole";
      return true;
    },
  },
  {
    name: "reorder a soul's memory",
    apply: (s) => {
      const id = firstSoulWith(s, (soul) => soul.memory.length >= 2 && soul.memory[0] !== soul.memory[1]);
      if (!id) return false;
      const m = s.souls[id]!.memory;
      [m[0], m[1]] = [m[1]!, m[0]!];
      return true;
    },
  },
  {
    name: "truncate an emotional history",
    apply: (s) => {
      const id = firstSoulWith(s, (soul) => soul.emotionalHistory.length > 0);
      if (!id) return false;
      s.souls[id]!.emotionalHistory.pop();
      return true;
    },
  },
  {
    name: "rewrite an emotional-history sample",
    apply: (s) => {
      const id = firstSoulWith(s, (soul) => soul.emotionalHistory.length > 0);
      if (!id) return false;
      s.souls[id]!.emotionalHistory[0] = s.souls[id]!.emotionalHistory[0]! + 7;
      return true;
    },
  },
  {
    name: "drop a whole soul",
    apply: (s) => {
      const id = Object.keys(s.souls)[0];
      if (!id) return false;
      delete s.souls[id];
      return true;
    },
  },
];

describe("audit C4 — any single degradation trips the checkpoint math", () => {
  it("every mutation class is caught across seeds (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: MUTATORS.length - 1 }), (seed, mi) => {
        const base = baseState(seed);
        const mutated = deepCopy(base);
        const mutator = MUTATORS[mi]!;
        fc.pre(mutator.apply(mutated));
        const caught =
          !isSuperset(mutated, base) || !countsNonDecreasing(counts(mutated), counts(base));
        expect(caught, `"${mutator.name}" escaped the checkpoint (seed ${seed})`).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("every mutator is genuinely exercisable on the fixture (no vacuous pre-skips)", () => {
    const base = baseState(1);
    for (const m of MUTATORS) {
      expect(m.apply(deepCopy(base)), `mutator "${m.name}" never applied — the property is vacuous for it`).toBe(true);
    }
  });

  it("pure accumulation still passes (the checkpoint is not fail-always)", () => {
    const base = baseState(2);
    const grown = deepCopy(base);
    const rng = new SeededRandom(99);
    advanceGame(grown, rng, "c4-grow");
    grown.suspicions!.push({ entity: "npc:2", suspicion: { id: "s-3", content: "a new hunch", ts: 3 } });
    grown.vaultIds!.push("vault-4");
    expect(isSuperset(grown, base)).toBe(true);
    expect(countsNonDecreasing(counts(grown), counts(base))).toBe(true);
  });
});
