import type { GameHouse } from "./characterFactory";
import type { GameEvent } from "../domain/event";
import type { EntityId } from "../domain/ids";
import type { LiveSeasonState } from "./liveSeason";
import type { Deal } from "../domain/deal";
import type { EdgeRecord, GameState, PersistedCharacter, PersistedSoul } from "../domain/saveState";

/**
 * The durable per-user game snapshot (feature 0030) — what makes the LIVE game
 * survive an engine restart. It bundles the session core the `GameSessionAdapter`
 * owns (house + week/phase/ceremony) with the engine detail that must not degrade
 * (events + relationship beliefs, 0007/0023). Everything here is plain JSON, so a
 * disk round-trip through `FileSaveStore` is lossless.
 *
 * ENGINE-ONLY: it carries the house's souls + the hidden relationship layer, so no
 * outward module may import it (enforced by dependency-cruiser, like the Vault).
 */
export interface CeremonyState {
  hoh?: EntityId;
  nominees: EntityId[];
  vetoHolder?: EntityId;
  vetoUsed: boolean;
}

/** The live-session core the `GameSessionAdapter` snapshots/restores. */
export interface SessionCore {
  started: boolean;
  week: number;
  phase: string;
  ceremony: CeremonyState;
  house: GameHouse | null;
  /** The incremental weekly-loop state (0011), so progression survives a restart (0030). */
  live?: LiveSeasonState | null;
  /** Tracked promises the player is party to (0039), so deals survive a restart (0030). */
  deals?: Deal[];
}

/** The full durable unit: the session core plus the engine detail (for non-degradation). */
export interface SessionSnapshot extends SessionCore {
  events: GameEvent[];
  relationships: EdgeRecord[];
}

export function cloneSession<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Project a durable snapshot into the 0007 `GameState` shape so the existing
 * non-degradation helpers (`counts`/`isSuperset`/`countsNonDecreasing`) apply
 * across a restart. Characters map to the static baseline; souls to the dynamic
 * (deepening) layer; relationships are the hidden beliefs.
 */
export function toGameState(snap: SessionSnapshot): GameState {
  const characters: Record<EntityId, PersistedCharacter> = {};
  const souls: Record<EntityId, PersistedSoul> = {};
  const all = snap.house ? [snap.house.player, ...snap.house.npcs] : [];
  for (const hg of all) {
    characters[hg.id] = {
      archetype: hg.character.archetype,
      strategyStyle: hg.character.strategyStyle,
      stats: hg.character.stats,
      background: hg.character.background,
    };
    souls[hg.id] = {
      emotionalState: hg.soul.emotionalState,
      volatility: hg.soul.volatility,
      emotionalHistory: [],
      memory: [...hg.soul.memory],
      relationshipBeliefs: snap.relationships.filter((e) => e.from === hg.id),
    };
  }
  return {
    coreVersion: 1,
    vaultVersion: 1,
    journalVersion: 1,
    events: snap.events,
    knowledge: [],
    relationships: snap.relationships,
    souls,
    characters,
  };
}
