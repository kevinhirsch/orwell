import type { RandomnessSource } from "../ports/RandomnessSource";
import type { GameState, PersistedSoul, PersistedCharacter } from "../domain/saveState";
import type { EntityId } from "../domain/ids";
import { generateHouse } from "./characterFactory";

/**
 * Builds and advances a `GameState` for the persistence feature. Advancing only
 * ever APPENDS (events, knowledge, edges) and DEEPENS the dynamic soul (memory,
 * emotional history, relationship beliefs); the static `Character` baseline is
 * never touched. Nothing is ever dropped — detail accumulates.
 */
export function newGameState(rng: RandomnessSource): GameState {
  const { npcs } = generateHouse(rng);
  const characters: Record<EntityId, PersistedCharacter> = {};
  const souls: Record<EntityId, PersistedSoul> = {};
  for (const hg of npcs) {
    characters[hg.id] = {
      archetype: hg.character.archetype,
      strategyStyle: hg.character.strategyStyle,
      stats: hg.character.stats,
      background: hg.character.background,
      // L28: the diverse backstory facets are part of the static baseline (byte-stable, never re-derived).
      ...(hg.character.vocation !== undefined ? { vocation: hg.character.vocation } : {}),
      ...(hg.character.hometown !== undefined ? { hometown: hg.character.hometown } : {}),
    };
    souls[hg.id] = { emotionalState: 0.5, volatility: hg.soul.volatility, emotionalHistory: [], memory: [], relationshipBeliefs: [] };
  }
  return {
    coreVersion: 1, vaultVersion: 0, journalVersion: 0,
    events: [], knowledge: [], relationships: [], souls, characters,
  };
}

export function advanceGame(state: GameState, rng: RandomnessSource, label: string): void {
  const ids = Object.keys(state.characters);
  const other = (a: EntityId): EntityId => {
    let b = rng.pick(ids);
    for (let g = 0; b === a && g < 16; g++) b = rng.pick(ids);
    return b;
  };

  // Append off-screen events.
  for (let k = 0; k < 4; k++) {
    const a = rng.pick(ids);
    const b = other(a);
    state.events.push({
      id: `e:${state.events.length}`, ts: state.events.length, type: "conversation",
      initiator: a, witnessSet: [a, b], hidden: true, content: `${a} talked with ${b} (${label})`,
    });
  }

  // Append a knowledge fact.
  const ke = rng.pick(ids);
  state.knowledge.push({
    entity: ke,
    fact: { id: `k:${state.knowledge.length}`, content: `learned something (${label})`, pathway: `told-by:${other(ke)}`, ts: state.knowledge.length },
  });

  // Append or strengthen a relationship edge (update allowed; never dropped).
  const ra = rng.pick(ids);
  const rb = other(ra);
  const existing = state.relationships.find((e) => e.from === ra && e.to === rb);
  if (existing) existing.trust = Math.min(1, existing.trust + 0.05);
  else state.relationships.push({ from: ra, to: rb, trust: 0.3, affinity: 0.3, threat: 0.1, alignment: 0.2, confidence: 0.1 });

  // Deepen every soul (the active "accumulate" requirement).
  for (const id of ids) {
    const soul = state.souls[id]!;
    soul.memory.push(`memory ${label} for ${id}`);
    soul.emotionalHistory.push(0.5 + (rng.next() - 0.5) * 0.2);
    if (rng.next() < 0.3) {
      soul.relationshipBeliefs.push({ from: id, to: other(id), trust: rng.next(), affinity: rng.next(), threat: rng.next(), alignment: rng.next(), confidence: rng.next() });
    }
  }
}
