import type { GameHouse } from "./characterFactory";
import type { DeepProfile, StoryThread } from "./deepProfile";
import type { CastingIntake } from "./castingIntake";
import type { GameEvent } from "../domain/event";
import type { EntityId } from "../domain/ids";
import type { LiveSeasonState } from "./liveSeason";
import type { Deal } from "../domain/deal";
import type { KnowledgeSnapshot } from "../domain/knowledge";
import type { EdgeRecord, GameState, PersistedCharacter, PersistedSoul } from "../domain/saveState";
import type { Room } from "../domain/house";
import type { HiddenRecord } from "../ports/VaultStore";

/**
 * The current durable-snapshot schema version (B40/audit C4). Bump when the shape changes; a save
 * carrying a HIGHER (unknown) version is rejected rather than silently mis-restored. A save with NO
 * version is a legacy (pre-B40) save and is migrated forward (it simply lacks the knowledge layer).
 */
export const SNAPSHOT_VERSION = 1;

/** A snapshot is loadable iff it is the current version or a versionless legacy save (migrate-forward). */
export function snapshotCompatible(snap: { snapshotVersion?: number }): boolean {
  return snap.snapshotVersion === undefined || snap.snapshotVersion === SNAPSHOT_VERSION;
}

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
  /** Who is in which room (0049), so presence survives a restart. Absent pre-0049 (reseeded on tick). */
  presence?: Record<EntityId, Room>;
  /**
   * The CALIBRATION-NEUTRAL base occupancy the off-screen society pairs on (L21/L24). Kept separate from
   * the personality-weighted `presence` (the player's view) so the society's co-presence — and thus the
   * seeded competition/vote outcomes — stays invariant to the movement-personality constants. Absent on
   * pre-L21/L24 saves (the next tick re-seeds it; `societyOccupancy` falls back to `presence` meanwhile).
   */
  presenceBase?: Record<EntityId, Room>;
  /** Room tenure — ticks each houseguest has held their current room (L21/L24). Absent on older saves (reseeded on the next tick). */
  presenceTenure?: Record<EntityId, number>;
  /**
   * The presence-tick COUNTER (L21/L24). Movement randomness rides a DEDICATED stream forked off the
   * game seed + this counter — never the orchestrator's shared per-user stream — so personality-weighted
   * movement can never perturb the competition/vote calibration (the seeded `juryReach` gate). Persisted
   * so the movement trajectory stays reproducible across a restart; absent ⇒ 0 (a resumed game continues
   * the deterministic sequence). The counter advances ONCE per `presenceTick`.
   */
  presenceTickCount?: number;
  /** The game's seed (B60/audit E12): the per-moment rng keys off it, so two same-named games diverge. */
  seed?: number;
  /** A half-done casting interview (0050) — additive/optional, so legacy saves stay version-1 loadable. */
  casting?: CastingIntake;
  /** Per-season photorealistic style anchor (0051): seeded at cast time, stable through the season. Absent on older saves (falls back to a default). */
  portraitStyleAnchor?: string;
  /**
   * The engine-only HIDDEN deep layer (feature 0058): the §3 secrets/goals/weakness/Day-1 perception
   * per NPC and the derived story THREADS (with their live `status`). Persisted here so a thread that
   * has ACTIVATED stays activated across a restart (0030) and the Day-1 perception re-seeds identically.
   * ENGINE-ONLY: the snapshot itself never crosses the wall (it carries the souls + relationships too),
   * so holding hidden profiles here leaks nothing. Absent on pre-0058 saves (re-derived deterministically
   * on restore from the persisted seed + cast — seed-stable & player-independent).
   */
  deepProfiles?: Record<EntityId, DeepProfile>;
  storyThreads?: StoryThread[];
  /**
   * Feature 0060 — the story-thread scheduler's engine-only, HIDDEN bookkeeping: the distinct weeks each
   * houseguest has been nominated (drives the `nominated-twice` trigger) and the count of threads that
   * have ever SURFACED this season (the hard restraint cap, §5). Persisted so both survive a restart
   * (0030) — a thread driven to a status stays at it, and the season cap is never re-opened by a reload.
   * Absent on pre-0060 saves (rebuilt forward from the current ceremony; the cap defaults to 0).
   */
  nominationWeeks?: Record<EntityId, number[]>;
  surfacedThreadCount?: number;
  /**
   * The engine-only HIDDEN seeded relationship layer (feature 0059): the sparse pre-game ties +
   * showmances seeded at cast time, Vault-sealed from the player AND the admin. Persisted so a
   * showmance stage never silently resets and the layer survives a restart (0030). ENGINE-ONLY (same
   * reasoning as deepProfiles above). Absent on pre-0059 saves (re-derived from the seed on restore).
   */
  seededRelationships?: import("./seededRelationships").SeededRelationships;
  /**
   * The engine-only HIDDEN private-orientation map (feature 0063): the orientation of each houseguest who
   * holds it PRIVATELY (closeted / not-yet-out), Vault-sealed from the player AND the admin. Persisted so
   * a closeted orientation never silently resets and survives a restart (0030). ENGINE-ONLY (same
   * reasoning as deepProfiles above). The PUBLIC diversity facets (ethnicity, gender presentation, an out
   * orientation) ride on the byte-stable Character. Absent on pre-0063 saves (re-derived from the seed on
   * restore ONLY for a truly pre-0063 cast; a 0063 cast with an empty map simply had everyone out).
   */
  privateOrientations?: Record<EntityId, import("./diversityConstants").Orientation>;
}

/** The full durable unit: the session core plus the engine detail (for non-degradation). */
export interface SessionSnapshot extends SessionCore {
  /** Schema version (B40); absent on legacy pre-B40 saves (migrated forward). */
  snapshotVersion?: number;
  events: GameEvent[];
  relationships: EdgeRecord[];
  /** The whole knowledge layer (B40/audit C2): facts + suspicions + counters. Absent on legacy saves. */
  knowledge?: KnowledgeSnapshot;
  /**
   * The Vault's hidden records (B53/audit I7): sealed twists, confessionals, hidden threads — so the
   * producer's secrets survive a restart like everything else (0030). Absent on older saves. The
   * snapshot itself is ENGINE-ONLY (see above), so carrying Vault content here crosses no wall.
   */
  vault?: HiddenRecord[];
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
/**
 * R3 — memoize the projection by snapshot IDENTITY. The integrity checkpoint (orchestrator) projects
 * the BASELINE and the CANDIDATE every commit, and the candidate of one commit is reused as the exact
 * baseline object of the next (orchestrator keeps it), and again as the supplementary off-screen tick's
 * baseline — so the same snapshot object is projected up to three times. `toGameState` is a PURE
 * function of its input, and snapshots are immutable once exported, so caching by object identity is
 * provably correct and cuts the redundant O(events) re-projection from the per-commit cost. A WeakMap
 * keeps it leak-free: an entry vanishes when the snapshot is collected.
 *
 * CONTRACT: callers MUST treat the result as READ-ONLY (the checkpoint's isSuperset/counts/playerSweep
 * all are). A mutating caller would corrupt a later memo hit — none exists, and none should.
 *
 * (This is the SAFE slice of R3. The remaining win — an incremental, O(Δ) export + isSuperset that
 * never walks the full event set — is a deeper redesign of the integrity spine and stays its own item.)
 */
const _gameStateCache = new WeakMap<SessionSnapshot, GameState>();

export function toGameState(snap: SessionSnapshot): GameState {
  const memo = _gameStateCache.get(snap);
  if (memo) return memo;
  const characters: Record<EntityId, PersistedCharacter> = {};
  const souls: Record<EntityId, PersistedSoul> = {};
  const all = snap.house ? [snap.house.player, ...snap.house.npcs] : [];
  // Group the edges by holder in ONE pass (preserving order) instead of re-`filter`ing the whole edge
  // list per houseguest — the old `snap.relationships.filter(e => e.from === hg.id)` inside the loop was
  // O(houseguests × edges). The grouped arrays are byte-identical to the per-holder filters (same order).
  const beliefsByHolder = new Map<EntityId, EdgeRecord[]>();
  for (const e of snap.relationships) {
    let list = beliefsByHolder.get(e.from);
    if (!list) { list = []; beliefsByHolder.set(e.from, list); }
    list.push(e);
  }
  for (const hg of all) {
    characters[hg.id] = {
      archetype: hg.character.archetype,
      strategyStyle: hg.character.strategyStyle,
      stats: hg.character.stats,
      background: hg.character.background,
      // L28: the diverse backstory facets are part of the byte-stable static baseline — included so
      // the 0031 checkpoint's superset/byte-compare guards them against regeneration/drift. Spread
      // (not nested) so an absent field on a pre-L28 save stays absent (no spurious superset failure).
      ...(hg.character.vocation !== undefined ? { vocation: hg.character.vocation } : {}),
      ...(hg.character.hometown !== undefined ? { hometown: hg.character.hometown } : {}),
      // L28 (voice register): part of the byte-stable baseline the checkpoint guards (conditional
      // spread keeps an absent field absent on a pre-demeanor save — no spurious superset failure).
      ...(hg.character.demeanor !== undefined ? { demeanor: hg.character.demeanor } : {}),
      // 0058: the PUBLIC deep-profile facets are part of the byte-stable static baseline — included so
      // the 0031 checkpoint's superset/byte-compare guards them against regeneration/drift. Spread
      // (not nested) so an absent field on a pre-0058 save stays absent (no spurious superset failure).
      ...(hg.character.biography !== undefined ? { biography: hg.character.biography } : {}),
      ...(hg.character.physicalCharacteristics !== undefined
        ? { physicalCharacteristics: hg.character.physicalCharacteristics } : {}),
    };
    souls[hg.id] = {
      emotionalState: hg.soul.emotionalState,
      volatility: hg.soul.volatility,
      // The live emotional trajectory (0041) — persisted + counted for non-degradation (0007/0030).
      emotionalHistory: [...(hg.soul.emotionalHistory ?? [])],
      memory: [...hg.soul.memory],
      relationshipBeliefs: beliefsByHolder.get(hg.id) ?? [],
    };
  }
  // The knowledge layer is now part of the snapshot (B40), so the non-degradation checkpoint (0031)
  // can see it — a restart that dropped what houseguests told the player would fail isSuperset/counts.
  const knowledge: GameState["knowledge"] = [];
  if (snap.knowledge) {
    for (const [entity, facts] of Object.entries(snap.knowledge.knowledge)) {
      for (const fact of facts) knowledge.push({ entity, fact });
    }
  }
  // Audit C4: suspicions + Vault records are persisted detail the checkpoint must see —
  // previously the projection dropped both, so whole classes of degradation were invisible
  // to the fail-closed 0031 gate. Vault crosses as IDS ONLY: the projection feeds the
  // checkpoint's counting/superset math, never an outward surface.
  const suspicions: NonNullable<GameState["suspicions"]> = [];
  if (snap.knowledge) {
    for (const [entity, list] of Object.entries(snap.knowledge.suspicions)) {
      for (const s of list) suspicions.push({ entity, suspicion: { id: s.id, content: s.content, ts: s.ts } });
    }
  }
  const gs: GameState = {
    coreVersion: 1,
    vaultVersion: 1,
    journalVersion: 1,
    events: snap.events,
    knowledge,
    relationships: snap.relationships,
    souls,
    characters,
    suspicions,
    vaultIds: (snap.vault ?? []).map((r) => r.id),
  };
  _gameStateCache.set(snap, gs);
  return gs;
}
