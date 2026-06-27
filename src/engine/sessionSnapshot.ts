import type { GameHouse } from "./characterFactory";
import type { DeepProfile, StoryThread } from "./deepProfile";
import type { CastingIntake } from "./castingIntake";
import type { GameEvent } from "../domain/event";
import type { EntityId } from "../domain/ids";
import type { LiveSeasonState } from "./liveSeason";
import type { Deal } from "../domain/deal";
import type { Campaign, Drive } from "./campaigns";
import type { Trajectory, FoldSignal } from "./trajectory";
import type { KnowledgeSnapshot } from "../domain/knowledge";
import type { EdgeRecord, GameState, PersistedCharacter, PersistedSoul } from "../domain/saveState";
import type { Room, Zone } from "../domain/house";
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

/**
 * A single persisted TRACKED-OCCUPANCY belief (0077 Phase 2): the player saw the subject (the map key)
 * head into `room` (+ `zone` flavor) at presence-tick `tick`; `pathway` + `confidence` make it a real
 * 0002 acquired-knowledge fact. Vault-free — position only, never the off-screen scene's content.
 */
export interface TrackedSighting {
  room: Room;
  zone?: Zone;
  tick: number;
  pathway: string;
  confidence: number;
}

/** The live-session core the `GameSessionAdapter` snapshots/restores. */
export interface SessionCore {
  started: boolean;
  /**
   * The monotonic per-sandbox beat counter (feature 0065 Part A) — increments by one on every
   * committed state mutation; stable on a no-op. Persisted here so the compare-and-swap stale-write
   * token is RESTART-SAFE and co-versioned with the save (0007/0030): after a resume the counter
   * resumes at the saved value, so a queued/in-flight write computed against the pre-restart board is
   * still correctly refused. NOT secret (a counter carries no Vault content), and it lives on the
   * 0007 GameState projection only as a scalar (never a `counts()` dimension), so it cannot trip a
   * non-degradation false positive. Absent on a pre-0065 save ⇒ 0 (a resumed game continues from 0;
   * the next commit bumps it — benign, since the FE's last-seen token resets across a restart too).
   */
  beatSeq?: number;
  week: number;
  phase: string;
  ceremony: CeremonyState;
  house: GameHouse | null;
  /** The incremental weekly-loop state (0011), so progression survives a restart (0030). */
  live?: LiveSeasonState | null;
  /** Tracked promises the player is party to (0039), so deals survive a restart (0030). */
  deals?: Deal[];
  /**
   * Live NPC CAMPAIGNS (feature 0085) — persistent, adaptive strategic agendas, so a multi-week
   * campaign and its accumulated history survive a restart (0030) and ACCUMULATE, never thin
   * (non-degradation #4). ENGINE-ONLY hidden strategy (it carries targets/plans/progress + the
   * per-perspective `knownTo` set), so it never crosses the wall — the snapshot already doesn't.
   * Absent on pre-0085 saves and whenever no campaign is running. (Phase A: the field + plumbing;
   * Phase B populates it from the live off-screen tick.)
   */
  campaigns?: Campaign[];
  /** The DEDICATED campaign-rng tick counter (0085 B2) — persisted so the campaign trajectory stays
   * reproducible across a restart; absent ⇒ 0. Never a calibration-spine input (its own forked stream). */
  campaignTickCount?: number;
  /** Every active houseguest's current DRIVE (0086) — sticky motivation+intensity, so an agenda survives a
   * restart instead of re-rolling. ENGINE-ONLY (hidden strategy). Absent on pre-0086 saves / when the
   * campaign layer is off. */
  drives?: Record<EntityId, Drive>;
  /**
   * RELATIONSHIP TRAJECTORIES (feature 0087) — the hidden MOMENTUM per directed pair (`"a->b"` → {phase,
   * momentum}), so a multi-week arc RESUMES mid-curdle across a restart and ACCUMULATES, never thins
   * (non-degradation #4). VAULT-CLASS hidden engine state (it carries no player/admin-visible number): the
   * snapshot itself never crosses the wall. Absent on pre-0087 saves AND whenever the trajectory layer is
   * off ⇒ every pair resumes at `steady`/0 (byte-identical to a pre-feature load).
   */
  trajectories?: Record<string, Trajectory>;
  /**
   * The tiny per-pair ring buffer of recent FOLD signals (0087) the phase is derived from — `"a->b"` → the
   * last `recencyWindow` signed bond/threat deltas (+ betrayal flag). Persisted beside `trajectories` so a
   * restored game derives the SAME phase from the SAME history. ENGINE-ONLY + Vault-free (deltas of a
   * nature's constant shape, never a raw edge number). Absent on pre-0087 saves / when the layer is off.
   */
  trajectoryFolds?: Record<string, FoldSignal[]>;
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
  /**
   * TRACKED OCCUPANCY (0077 Phase 2): the PLAYER's persisted beliefs about who is behind a closed door —
   * acquired knowledge (a witnessed movement), keyed by subject, carrying a pathway + confidence + the
   * sighting tick. Persisted so the privacy payoff accumulates across a restart (0007); absent on older
   * saves. Vault-free (position, never the scene's content).
   */
  trackedSightings?: Record<EntityId, TrackedSighting>;
  /** The game's seed (B60/audit E12): the per-moment rng keys off it, so two same-named games diverge. */
  seed?: number;
  /**
   * The PRODUCER persona's seed (producer-persona feature). The producer is the OFF-CAMERA casting-interview
   * voice — a seeded, reproducible persona, NOT one of the 16 (no headshot, never in the roster). The
   * interview runs PRE-GAME, so this seed is established (and persisted) lazily before any season seed
   * exists, so the same producer is voiced across turns and a restart; at season start it is set to the
   * season `seed`. Absent on pre-feature saves AND a fresh pre-interview session (re-minted on first need).
   */
  producerSeed?: number;
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
   * 0065 — a PRE-WARMED but not-yet-finalized cast: the player-INDEPENDENT cast `preSeedCast` generates
   * during the casting interview (before `createCharacter`), possibly already FE-authored deeply. Persisted
   * so a half-warmed cast survives a restart and resumes (0030) rather than re-warming from scratch.
   * ENGINE-ONLY (it carries the hidden deep layer + private orientations). Absent once the season starts
   * (the cast is adopted onto the live house and the holding store is cleared). Absent on all prior saves.
   */
  prewarm?: {
    seed: number;
    npcs: GameHouse["npcs"];
    deepProfiles: Record<EntityId, DeepProfile>;
    storyThreads: StoryThread[];
    privateOrientations: Record<EntityId, import("./diversityConstants").Orientation>;
    groundedSkinTones: Record<EntityId, string>;
    portraitStyleAnchor: string;
  };
  /**
   * 0065 (advance-warm) — the durable NEXT-season holding-store mirror: the cast pre-warmed DURING the
   * current season's finale, off a NEW seed, into a per-user buffer that survives the cutover. Persisted
   * on the LIVE sandbox so an advance-warm begun mid-finale survives an engine restart and is still
   * adopted at the confirmed cutover. SAME shape as `prewarm` (it IS a held PrewarmCast). ENGINE-ONLY (it
   * carries the hidden deep layer + private orientations). Absent until an advance-warm runs; cleared once
   * the cutover consumes it. Absent on all prior saves.
   */
  nextSeasonWarm?: {
    seed: number;
    npcs: GameHouse["npcs"];
    deepProfiles: Record<EntityId, DeepProfile>;
    storyThreads: StoryThread[];
    privateOrientations: Record<EntityId, import("./diversityConstants").Orientation>;
    groundedSkinTones: Record<EntityId, string>;
    portraitStyleAnchor: string;
  };
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
   * Feature 0075 — the trust-gated confidence ledger: per-houseguest, the highest TIER they have
   * confided to the player (monotonic for a true secret) + whether that disclosure was truthful (a
   * lie is engine-side only). `confideLieCount` is the per-season lie count (the hard cap). Persisted
   * so a restored game remembers exactly what the player was told, never re-tells a secret at a lower
   * tier, and never re-opens the lie cap. Absent on pre-0075 saves ⇒ empty/zero (non-degradation).
   */
  confideState?: Record<EntityId, { tier: "none" | "tease" | "partial" | "full"; truthful: boolean }>;
  confideLieCount?: number;
  /**
   * The engine-only HIDDEN seeded relationship layer (feature 0059): the sparse pre-game ties +
   * showmances seeded at cast time, Vault-sealed from the player AND the admin. Persisted so a
   * showmance stage never silently resets and the layer survives a restart (0030). ENGINE-ONLY (same
   * reasoning as deepProfiles above). Absent on pre-0059 saves (re-derived from the seed on restore).
   */
  seededRelationships?: import("./seededRelationships").SeededRelationships;
  /**
   * 0059 §5 — the organic tie-surfacing scheduler's hidden bookkeeping (the DEFERRED follow-on, opt-in).
   * `playerTieSurfaceCount` is the per-season count of pre-game ties that have surfaced TO THE PLAYER (the
   * hard cap); `surfacedTieSubjects` are the tie subjects already surfaced (so a tie never re-spends the
   * cap); `tieScheduleTickCount` is the DEDICATED rng's tick counter. Persisted so a discovered tie stays
   * discovered, the cap is never re-opened by a reload, and the stream stays reproducible (non-degradation,
   * 0007/0030). All ENGINE-ONLY (Vault-sealed). Absent on saves with the scheduler off / pre-§5 (⇒ 0/empty).
   */
  playerTieSurfaceCount?: number;
  surfacedTieSubjects?: string[];
  tieScheduleTickCount?: number;
  /**
   * The engine-only HIDDEN private-orientation map (feature 0063): the orientation of each houseguest who
   * holds it PRIVATELY (closeted / not-yet-out), Vault-sealed from the player AND the admin. Persisted so
   * a closeted orientation never silently resets and survives a restart (0030). ENGINE-ONLY (same
   * reasoning as deepProfiles above). The PUBLIC diversity facets (ethnicity, gender presentation, an out
   * orientation) ride on the byte-stable Character. Absent on pre-0063 saves (re-derived from the seed on
   * restore ONLY for a truly pre-0063 cast; a 0063 cast with an empty map simply had everyone out).
   */
  privateOrientations?: Record<EntityId, import("./diversityConstants").Orientation>;
  /**
   * The move-in zeitgeist snapshot (feature 0062): the ONE frozen, shared real-world flavor the whole
   * cast moved in with. Captured ONCE at season creation, FROZEN byte-stable, and persisted here so it
   * survives a restart (0030) and is recalled — never re-searched — all season (§9). OUTWARD-SAFE by
   * construction: it is public, shared real-world flavor (a THIRD state category — neither Vault-secret
   * nor game truth, §6), so carrying it on this engine-only core leaks nothing and it MAY cross to the
   * player- and off-screen-facing prompts. Absent on pre-0062 saves AND when no snapshot was captured
   * (the §8 fail-soft skip) — an absent snapshot round-trips as absent and changes no outcome.
   */
  worldSnapshot?: import("./zeitgeist").WorldSnapshot;
  /**
   * PREMIERE — the meet-everyone tracker (feature #380 follow-on): the ids of the houseguests the
   * player has been INTRODUCED to so far during the premiere. Persisted so a half-done premiere
   * survives a restart (0030) and resumes where it left off — the producer never re-introduces someone
   * already met, and never loses track of who is still to meet. Public ids (no Vault data). Absent on a
   * pre-feature save AND once the premiere is over (the tracker is cleared when the first HOH begins).
   */
  premiereIntros?: EntityId[];
  /**
   * 0070 — the additive prose texture layer: model-voiced content indexed by event id. Only
   * applied when the underlying event is already hidden (never creates events, never alters the
   * closed set). Persisted so enriched scenes survive a restart byte-identical (0030). Absent on
   * pre-0070 saves (no texture; the deterministic template content simply stands).
   */
  textureOverrides?: Record<string, string>;
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
 * R3 — a structural deep clone that is BYTE-IDENTICAL to `cloneSession` (the JSON round-trip) for any
 * JSON-safe value, without paying to serialize+reparse every string char-by-char. It mirrors
 * `JSON.parse(JSON.stringify(x))` semantics exactly for the value types a `SessionCore`/`GameHouse`
 * holds (objects, arrays, string/number/boolean/null): a property whose value is `undefined`, a
 * function, or a symbol is DROPPED (as JSON does); the same in an array position becomes `null`; a
 * non-finite number becomes `null`; a `toJSON()` method (e.g. on a Date) is honored before recursion.
 * Immutable primitives (strings/numbers) are shared, not re-allocated — that is the whole win: the
 * per-turn snapshot export deep-clones each houseguest's ever-growing append-only `soul.memory`, and
 * re-JSON-serializing the full log every turn was the O(events) cost behind the late-season latency
 * (audit R3). Used ONLY where the input is known JSON-safe (the house/live clones); `cloneSession`
 * stays the default elsewhere. Verified equivalent in `tests/unit/incrementalSnapshot.test.ts`.
 */
export function fastClone<T>(value: T): T {
  return cloneJsonLike(value) as T;
}

function cloneJsonLike(v: unknown): unknown {
  if (v === null) return null;
  const t = typeof v;
  if (t === "string" || t === "boolean") return v;
  if (t === "number") return Number.isFinite(v as number) ? v : null; // JSON: NaN/±Infinity → null
  if (t !== "object") return undefined; // function/symbol/undefined → caller drops (object/array path)
  // Honor toJSON (Date etc.) exactly like JSON.stringify would, then clone the produced value.
  const obj = v as { toJSON?: (key?: string) => unknown };
  if (typeof obj.toJSON === "function") return cloneJsonLike(obj.toJSON());
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const c = cloneJsonLike(v[i]);
      out[i] = c === undefined ? null : c; // JSON: undefined/function in an array slot → null
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    const c = cloneJsonLike((v as Record<string, unknown>)[k]);
    if (c !== undefined) out[k] = c; // JSON: a property whose value is undefined/function is dropped
  }
  return out;
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
      // #1067: the season-start authoring provenance flag — drives the ONE sanctioned floor→authored public-
      // facet upgrade the 0031 checkpoint permits. Spread (not nested) so it stays absent on the seeded floor
      // and on pre-#1067 saves (no spurious change to the byte-compare for an un-authored character).
      ...(hg.character.deepProfileAuthored === true ? { deepProfileAuthored: true } : {}),
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
    // 0062 — the frozen zeitgeist snapshot rides into the 0007 projection so the non-degradation
    // checkpoint (0031) byte-stable-guards it (it must never regenerate or drift). Conditional spread
    // keeps an absent snapshot absent (a pre-0062 / no-provider save never trips a spurious failure).
    ...(snap.worldSnapshot !== undefined
      ? { worldSnapshot: snap.worldSnapshot as unknown as Record<string, unknown> }
      : {}),
  };
  _gameStateCache.set(snap, gs);
  return gs;
}
