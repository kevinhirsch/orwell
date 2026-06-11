import type { EntityId } from "./ids";
import type { GameEvent } from "./event";
import type { KnowledgeFact } from "./knowledge";

/**
 * The persisted game state. Detail must NEVER regress across saves and should
 * accumulate/deepen (mandate #4). A save = { coreVersion, Vault store, Journal
 * store }; the Vault and Journal versions bump together. Everything here is
 * plain JSON (no Maps/Sets/undefined) so serialize→deserialize is lossless.
 */
export interface EdgeRecord {
  from: EntityId;
  to: EntityId;
  trust: number;
  affinity: number;
  threat: number;
  alignment: number;
  confidence: number;
  /** Demonstrated loyalty (ADR 0002 / audit E54). Optional: pre-E54 saves load at baseline. */
  reliability?: number;
}

/** Dynamic — grows over the game. */
export interface PersistedSoul {
  emotionalState: number;
  volatility: number;
  emotionalHistory: number[];
  memory: string[];
  relationshipBeliefs: EdgeRecord[];
}

/** Static baseline — set at generation, byte-stable thereafter. */
export interface PersistedCharacter {
  archetype: string;
  strategyStyle: string;
  stats: { physical: number; mental: number; social: number };
  background: string;
}

export interface GameState {
  coreVersion: number;
  vaultVersion: number;
  journalVersion: number;
  events: GameEvent[];
  knowledge: Array<{ entity: EntityId; fact: KnowledgeFact }>;
  relationships: EdgeRecord[];
  souls: Record<EntityId, PersistedSoul>;
  characters: Record<EntityId, PersistedCharacter>;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(blob: string): GameState {
  return JSON.parse(blob) as GameState;
}

export function deepCopy(state: GameState): GameState {
  return deserialize(serialize(state));
}

export interface DetailCounts {
  events: number;
  knowledge: number;
  relationships: number;
  soulMemory: number;
  soulHistory: number;
  soulBeliefs: number;
}

export function counts(state: GameState): DetailCounts {
  const souls = Object.values(state.souls);
  const sum = (f: (s: PersistedSoul) => number): number => souls.reduce((a, s) => a + f(s), 0);
  return {
    events: state.events.length,
    knowledge: state.knowledge.length,
    relationships: state.relationships.length,
    soulMemory: sum((s) => s.memory.length),
    soulHistory: sum((s) => s.emotionalHistory.length),
    soulBeliefs: sum((s) => s.relationshipBeliefs.length),
  };
}

/** Superset by stable identity: nothing previously persisted may be dropped. */
export function isSuperset(later: GameState, earlier: GameState): boolean {
  const has = (ids: Set<string>, want: Iterable<string>): boolean => {
    for (const id of want) if (!ids.has(id)) return false;
    return true;
  };

  if (!has(new Set(later.events.map((e) => e.id)), earlier.events.map((e) => e.id))) return false;
  if (!has(new Set(later.knowledge.map((k) => k.fact.id)), earlier.knowledge.map((k) => k.fact.id))) return false;
  if (!has(new Set(later.relationships.map((e) => `${e.from}->${e.to}`)), earlier.relationships.map((e) => `${e.from}->${e.to}`))) return false;

  for (const [id, early] of Object.entries(earlier.souls)) {
    const late = later.souls[id];
    if (!late) return false;
    if (late.memory.length < early.memory.length) return false;
    if (!has(new Set(late.memory), early.memory)) return false;
    if (late.emotionalHistory.length < early.emotionalHistory.length) return false;
    if (late.relationshipBeliefs.length < early.relationshipBeliefs.length) return false;
  }
  return true;
}

export function countsNonDecreasing(later: DetailCounts, earlier: DetailCounts): boolean {
  return (Object.keys(earlier) as Array<keyof DetailCounts>).every((k) => later[k] >= earlier[k]);
}
