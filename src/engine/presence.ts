/**
 * Presence assignment + overhearing (feature 0049). Seeded, relationship-weighted occupancy —
 * facts the narrator queries, not a simulation the player operates. Allies drift together,
 * the HOH gravitates upstairs, schemers find space — all through the seeded RandomnessSource
 * (same seed, same trajectories), with movement constrained to the floor plan.
 */
import { HOUSE_ROOMS, HOUSE_ADJACENCY, areAdjacent, isZonedRoom, pickZone, type Room, type Zone, type Occupancy } from "../domain/house";
import { PLAYER } from "../domain/ids";
import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { KnowledgeService } from "../ports/KnowledgeService";
import { PRESENCE, MOVEMENT_PERSONALITY } from "./presenceConstants";

/** A tiny deterministic string hash (FNV-1a) — pure, draws no rng. Used only to seat zones reproducibly. */
function zoneHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Deterministically seat an entity into a sub-zone of their (zoned) room (0077 Phase 2) — PURE, draws
 * NO rng, and STABLE for a given (id, room, salt), so the same houseguest reads the same corner of the
 * yard all game (flavor continuity) and the seating can never perturb the seeded calibration spine.
 * Returns `undefined` for an un-zoned room. The salt is a per-game constant (the game seed).
 */
export function zoneFor(id: EntityId, room: Room, salt: string | number = ""): Zone | undefined {
  if (!isZonedRoom(room)) return undefined;
  return pickZone(room, zoneHash(`${salt}:${id}:${room}`));
}

/**
 * A houseguest's movement personality (L21/L24) — WHO they are, read off the static CHARACTER +
 * dynamic SOUL: `social` is their social aptitude (`stats.social`, ~0–1), `volatility` their current
 * emotional turbulence (`soul.volatility`, ~0–1; `0.5` is settled). The caller supplies these so the
 * pure presence module never reaches into the engine's character/soul state directly. ABSENT ⇒ the
 * base (pre-L21/L24) behavior — every term defaults to its no-op center, so old call sites are
 * byte-for-byte unchanged.
 */
export interface MovementProfile {
  /** Social aptitude (static `stats.social`, ~0–1). High ⇒ roams + seeks company; low ⇒ holds a room. */
  social: number;
  /** Current emotional turbulence (dynamic `soul.volatility`, ~0–1; `0.5` settled). High ⇒ restless. */
  volatility: number;
}

export interface PresenceDeps {
  rng: RandomnessSource;
  /** Directed affinity read (0017/0026) — how much `a` wants to be around `b`. */
  affinity: (a: EntityId, b: EntityId) => number;
  hoh?: EntityId | null;
  /**
   * Per-NPC movement personality (L21/L24). Optional: when absent (or returns null for an id), that
   * houseguest moves on the base 0049 behavior — so this is a pure additive nudge, no behavior change
   * for callers that don't supply it. The profile DRAWS NO rng of its own; it only re-weights the
   * move-gate threshold and the affinity pull. The L21/L24 isolation comes from the CALLER routing this
   * `rng` to a dedicated movement stream (`presenceTick`) — separate from the shared competition/vote
   * stream — and from the off-screen society pairing on a calibration-neutral, un-weighted base occupancy.
   */
  movement?: (id: EntityId) => MovementProfile | null;
  /**
   * The player's CURRENT room (feature 0076) — the live scene. When set (the player-facing WEIGHTED
   * pass only), an NPC who is already in this room uses `sceneMoveProb` for the stay-gate instead of
   * their ordinary move rate, so present company holds a live conversation instead of churning out
   * every tick. Absent (the calibration-neutral BASE pass) ⇒ no scene stickiness, behavior unchanged.
   */
  sceneRoom?: Room | null;
  /**
   * The (low) per-tick MOVE probability for an NPC standing in `sceneRoom` (feature 0076). Applies
   * ONLY when `sceneRoom` is set and the NPC is in it. Consumes the SAME single stay-gate `rng.next()`
   * draw as the ordinary path (only the THRESHOLD differs), so the per-NPC draw count is unchanged.
   */
  sceneMoveProb?: number;
}

/** The signed social deviation from center, used by both the move-rate and seek-pull nudges. */
function socialDeviation(p: MovementProfile | null | undefined): number {
  return p ? p.social - MOVEMENT_PERSONALITY.socialCenter : 0;
}

/**
 * A houseguest's personality-adjusted MOVE probability for this tick (L21/L24). High social aptitude
 * and a churning (high-volatility) soul both raise it; low social aptitude lowers it. Clamped into a
 * hard [floor, ceiling] so nobody ever fully freezes or always-teleports. With no profile this returns
 * the base `PRESENCE.moveProb` exactly (no behavior change). Reads personality data, draws NO rng.
 */
function moveProbFor(p: MovementProfile | null | undefined): number {
  if (!p) return PRESENCE.moveProb;
  const M = MOVEMENT_PERSONALITY;
  const fromSocial = socialDeviation(p) * M.moveAptitudeWeight;
  const fromVolatility = (p.volatility - 0.5) * M.volatilityWeight;
  const adjusted = PRESENCE.moveProb + fromSocial + fromVolatility;
  return Math.max(M.moveProbFloor, Math.min(M.moveProbCeil, adjusted));
}

/**
 * A houseguest's personality-adjusted AFFINITY PULL toward occupied rooms (L21/L24): high-social
 * houseguests seek company more strongly, low-social ones less. Floored at 0 (never repulsion). With
 * no profile this returns the base `PRESENCE.affinityPull` exactly. Reads personality data, draws NO rng.
 */
function seekPullFor(p: MovementProfile | null | undefined): number {
  if (!p) return PRESENCE.affinityPull;
  const M = MOVEMENT_PERSONALITY;
  return Math.max(M.seekPullFloor, PRESENCE.affinityPull + socialDeviation(p) * M.seekAptitudeWeight);
}

/**
 * Assign every ACTIVE houseguest exactly one room. With a previous occupancy, each houseguest
 * either stays put or moves to an ADJACENT room (no teleporting — ADR 0003 §8); the very first
 * assignment may place anyone anywhere. Deterministic for a given rng stream: iteration order
 * is the caller's `active` array (stable), choices come only from `rng`.
 */
export function assignRooms(
  active: readonly EntityId[],
  previous: Occupancy | null,
  deps: PresenceDeps,
  // PINNED houseguests are seated FIRST and never moved — the engine drives only `active`, but the
  // pinned still pull the movers (affinity clustering reads them). Used to hold the PLAYER in place
  // (a person, not engine-relocated — L21/L24) while NPCs may still gravitate to the player's room.
  pinned?: Occupancy | null,
): Map<EntityId, Room> {
  const next = new Map<EntityId, Room>(pinned ?? undefined);
  for (const id of active) {
    const here = previous?.get(id);
    // L21/L24: who this houseguest IS bends HOW they move — read once per houseguest (no rng draw),
    // so the per-NPC `rng` draw count is identical with or without a profile (the isolation guarantee).
    const profile = deps.movement?.(id) ?? null;
    // Candidate rooms: anywhere on first assignment; stay-or-adjacent afterwards. The diary
    // room is never a hangout (it is a booth, not a lounge).
    const candidates: readonly Room[] = (here
      ? [here, ...(HOUSE_ADJACENCY.get(here) ?? [])]
      : HOUSE_ROOMS
    ).filter((r) => r !== "diary-room");
    // The stay-vs-move gate, bent by personality (L21/L24): a high-social/restless houseguest roams
    // more, a low-social/settled one holds their room. ONE `rng.next()` draw, exactly as before — the
    // personality only moves the THRESHOLD it is compared against (no extra draw). This `rng` is the
    // DEDICATED movement stream (`presenceTick`), never the shared competition/vote stream, so however
    // the threshold shifts which branch is taken it cannot perturb calibration (the L21/L24 isolation).
    //
    // 0076: present company holds the scene. When this NPC is in the PLAYER'S room (`sceneRoom`, set only
    // on the weighted pass), the gate uses the low `sceneMoveProb` instead of their ordinary rate — they
    // stay by default but keep full agency to leave (the low roll still fires, and the affinity-weighted
    // destination below reads as a motivated exit). Still ONE draw, so the per-NPC draw count is unchanged.
    const moveThreshold =
      here !== undefined && here === deps.sceneRoom && deps.sceneMoveProb !== undefined
        ? deps.sceneMoveProb
        : moveProbFor(profile);
    if (here && deps.rng.next() >= moveThreshold) {
      next.set(id, here); // most ticks, most people stay where they are
      continue;
    }
    // Weight each candidate by who is already there (affinity pull, bent by how much THIS houseguest
    // seeks company — L21/L24) + the HOH-room pull.
    const seekPull = seekPullFor(profile);
    const weights = candidates.map((room) => {
      let w = 1;
      for (const [other, theirRoom] of next) {
        if (theirRoom === room) w += seekPull * deps.affinity(id, other);
      }
      if (room === "hoh-room") w = id === deps.hoh ? w + PRESENCE.hohRoomPull * 4 : w * PRESENCE.hohRoomPull;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = deps.rng.next() * total;
    let chosen = candidates[candidates.length - 1]!;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) { chosen = candidates[i]!; break; }
    }
    next.set(id, chosen);
  }
  return next;
}

/**
 * Roll the adjacency overhear for one resolved scene (BOTH directions by construction — the
 * listeners are simply whoever occupies an adjacent room, player or NPC). ONE gate per scene,
 * ONE ear when it opens (the player has priority — the flagship beat is player-centric): an
 * overhear is a RARE, special beat, not a chorus, and every one is a recorded propagation
 * event the persistence layer pays for. A success surfaces a PARTIAL, lower-confidence belief
 * through the real 0002 pathway (`overheard:<eventId>`), so every overhear is traceable —
 * eavesdropping is information-gathering, never narrative vibes. Returns who overheard.
 */
export function rollOverhears(deps: {
  eventId: string;
  room: Room;
  content: string;
  participants: readonly EntityId[];
  occupancy: Occupancy;
  knowledge: KnowledgeService;
  rng: RandomnessSource;
  /**
   * Closed-door MUFFLE (0077 Phase 2, OPT-IN): a multiplier on the per-scene gate probability — a
   * scene behind a closed door is harder to hear into. ABSENT ⇒ `1` ⇒ the gate threshold and thus
   * the entire draw branch are BYTE-IDENTICAL to the pre-0077 build. The off-screen society/spine
   * passes nothing here (calibration stays sacred); only the player channel — on its own isolated
   * `commands:` rng stream — opts in.
   */
  muffle?: number;
}): EntityId[] {
  const listeners: EntityId[] = [];
  for (const [id, where] of deps.occupancy) {
    if (deps.participants.includes(id)) continue; // you can't overhear your own scene
    if (!areAdjacent(where, deps.room)) continue; // walls work; only next door listens
    listeners.push(id);
  }
  if (listeners.length === 0) return [];
  // ONE gate draw, exactly as before — only the THRESHOLD shifts when a caller opts into the muffle
  // (a closed-door scene is quieter). `muffle ?? 1` ⇒ no caller ⇒ the original `overhearProb`.
  if (deps.rng.next() >= PRESENCE.overhearProb * (deps.muffle ?? 1)) return []; // gated per scene, never guaranteed
  const who = listeners.includes(PLAYER) ? PLAYER : listeners[deps.rng.int(listeners.length)]!;
  // Partial by DESIGN and by construction: the overhearer catches a strict fragment (never the
  // whole line), so a hidden scene's full content can never reach anyone verbatim through a wall —
  // the orchestrator's vault-leak checkpoint (a full-content substring sweep) stays strict and green.
  const caught = deps.content.slice(0, Math.max(1, Math.floor(deps.content.length * PRESENCE.overhearFraction)));
  deps.knowledge.surfaceInformationTo(
    who,
    { content: `(overheard, muffled) ${caught}…`, confidence: PRESENCE.overhearConfidence },
    `overheard:${deps.eventId}`,
  );
  return [who];
}
