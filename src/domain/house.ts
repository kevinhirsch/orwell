/**
 * The house itself (feature 0049): canonical rooms + a static adjacency map, in the pure
 * domain core. Adjacency is DATA, not behavior — the same house every season (it doesn't
 * remodel), so presence facts ("who's here, who's one room over") have stable ground truth.
 * No I/O, no randomness: occupancy ASSIGNMENT lives in the engine (`src/engine/presence.ts`);
 * this module only knows the floor plan and the invariants.
 */
import type { EntityId } from "./ids";

export type Room =
  | "kitchen" | "living-room" | "dining-room" | "backyard"
  | "hallway"
  | "bedroom-a" | "bedroom-b" | "bedroom-c" | "bathroom" | "lounge"
  | "hoh-room" | "storage-room" | "diary-room";

export const HOUSE_ROOMS: readonly Room[] = [
  "kitchen", "living-room", "dining-room", "backyard",
  "hallway",
  "bedroom-a", "bedroom-b", "bedroom-c", "bathroom", "lounge",
  "hoh-room", "storage-room", "diary-room",
];

/**
 * The floor plan (0077 — recent-BB layout). Symmetric by construction (asserted by the unit tests):
 * an OPEN PUBLIC CORE where privacy is impossible (kitchen ⇄ living-room ⇄ dining-room ⇄ backyard),
 * a `hallway` chokepoint off the living room, and a PRIVATE WING reached only through the hallway
 * (the three bedrooms, the bathroom, the lounge). The HOH room sits up its own stairs off the living
 * room; the storage room is the classic quick-meeting spot off the kitchen; the diary room opens off
 * the living room and adjoins nothing else (PRIVATE — overhearing it is impossible by data). Owner
 * note #1: the BATHROOM is NOT adjacent to any bedroom (it opens off the hallway).
 */
export const HOUSE_ADJACENCY: ReadonlyMap<Room, readonly Room[]> = new Map<Room, readonly Room[]>([
  ["kitchen", ["living-room", "dining-room", "backyard", "storage-room"]],
  ["living-room", ["kitchen", "dining-room", "backyard", "hallway", "hoh-room", "diary-room"]],
  ["dining-room", ["kitchen", "living-room"]],
  ["backyard", ["kitchen", "living-room"]],
  ["hallway", ["living-room", "bedroom-a", "bedroom-b", "bedroom-c", "bathroom", "lounge"]],
  ["bedroom-a", ["hallway"]],
  ["bedroom-b", ["hallway"]],
  ["bedroom-c", ["hallway"]],
  ["bathroom", ["hallway"]],
  ["lounge", ["hallway"]],
  ["hoh-room", ["living-room"]],
  ["storage-room", ["kitchen"]],
  ["diary-room", ["living-room"]],
]);

export function areAdjacent(a: Room, b: Room): boolean {
  return a !== b && (HOUSE_ADJACENCY.get(a) ?? []).includes(b);
}

/**
 * The PUBLIC, natural display name for a room (the same `kitchen`/`living room`/`bedroom A`
 * the player and narrator say aloud). Pure presentation of a public room id — never a Vault
 * fact. Drives the model-facing room list so the narrator always knows the exact names it can
 * walk the player to, and grounds the "did you mean…" disambiguation.
 */
export function roomDisplayName(room: Room): string {
  if (room === "hoh-room") return "HOH room";
  // bedroom-a → "bedroom A", living-room → "living room", etc.
  return room.replace(/-([a-z])$/i, (_m, c: string) => ` ${c.toUpperCase()}`).replace(/-/g, " ");
}

/**
 * The rooms the player can actually WALK to — every real room except the diary room (a booth the
 * player enters via the Diary Room beat, never a hangout to mill in; ADR 0003 §8). The canonical,
 * ordered list the narrator is handed so it never has to GUESS a room id. Public/Vault-free.
 */
export const WALKABLE_ROOMS: readonly Room[] = HOUSE_ROOMS.filter((r) => r !== "diary-room");

/**
 * Natural-name → room-id ALIASES (the forgiving `moveTo` map). Keys are normalized (see
 * `normalizeRoomName`): lowercase, spaces/underscores/hyphens collapsed to a single hyphen. These
 * cover the names a narrator or player naturally says — "living room"/"lounge", "backyard"/"yard",
 * "HOH"/"head of household", "bathroom"/"washroom", "pantry" (the storage room). The bare "bedroom"
 * is handled specially (it is AMBIGUOUS — two bedrooms) by `resolveRoom`, never here.
 */
const ROOM_ALIASES: ReadonlyMap<string, Room> = new Map<string, Room>([
  ["kitchen", "kitchen"],
  ["living-room", "living-room"],
  ["livingroom", "living-room"],
  ["living", "living-room"],
  ["common-room", "living-room"],
  ["common-area", "living-room"],
  ["great-room", "living-room"],
  ["dining-room", "dining-room"],
  ["dining", "dining-room"],
  ["dining-area", "dining-room"],
  ["dinner", "dining-room"],
  ["backyard", "backyard"],
  ["yard", "backyard"],
  ["outside", "backyard"],
  ["garden", "backyard"],
  ["patio", "backyard"],
  ["pool", "backyard"],
  ["poolside", "backyard"],
  ["hallway", "hallway"],
  ["hall", "hallway"],
  ["corridor", "hallway"],
  ["bedroom-a", "bedroom-a"],
  ["bedroom-1", "bedroom-a"],
  ["first-bedroom", "bedroom-a"],
  ["bedroom-b", "bedroom-b"],
  ["bedroom-2", "bedroom-b"],
  ["second-bedroom", "bedroom-b"],
  ["bedroom-c", "bedroom-c"],
  ["bedroom-3", "bedroom-c"],
  ["third-bedroom", "bedroom-c"],
  ["lounge", "lounge"],
  ["games-room", "lounge"],
  ["game-room", "lounge"],
  ["have-not", "lounge"],
  ["have-not-room", "lounge"],
  ["hoh-room", "hoh-room"],
  ["hoh", "hoh-room"],
  ["hoh-suite", "hoh-room"],
  ["hoh-bedroom", "hoh-room"],
  ["head-of-household", "hoh-room"],
  ["head-of-household-room", "hoh-room"],
  ["bathroom", "bathroom"],
  ["washroom", "bathroom"],
  ["restroom", "bathroom"],
  ["toilet", "bathroom"],
  ["storage-room", "storage-room"],
  ["storage", "storage-room"],
  ["pantry", "storage-room"],
  ["diary-room", "diary-room"],
  ["diary", "diary-room"],
  ["dr", "diary-room"],
]);

/**
 * Normalize a free-text room name to the alias-key form: lowercase, trim, every run of
 * whitespace/underscore/hyphen collapsed to a single hyphen. So "Living Room", "living_room",
 * "LIVING-ROOM", and " living  room " all key to "living-room". Case/space/hyphen-insensitive.
 */
export function normalizeRoomName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The shape of a room-name resolution (see `resolveRoom`). */
export type RoomResolution =
  /** Exactly one room matched — walk there. */
  | { kind: "ok"; room: Room }
  /** The name is a real room but AMBIGUOUS (e.g. bare "bedroom") — the candidates, best-guess first. */
  | { kind: "ambiguous"; candidates: readonly Room[] }
  /** No room matches at all. */
  | { kind: "unknown" };

/**
 * Resolve a FREE-TEXT room name (whatever the narrator/player typed) to a canonical room id —
 * forgiving by design so a guessed "bedroom" or "living room" never silently fails into a retry
 * loop (the real-log bug). Pure + deterministic + Vault-free (rooms are public):
 *   1. exact room id / known alias (case/space/hyphen-insensitive);
 *   2. the bare word "bedroom" / "bed" / "room" → AMBIGUOUS across the two bedrooms, but
 *      DISAMBIGUATED to a single room when context allows: the player's CURRENT bedroom if they
 *      are already in one (stay), else a bedroom ADJACENT to where they stand, else bedroom-a;
 *   3. a loose substring/prefix match against the canonical names (e.g. "kit" → kitchen);
 *   4. otherwise unknown.
 * `currentRoom` (where the player stands) only sharpens the bedroom/loose disambiguation; omit it
 * and a bare "bedroom" simply reports both bedrooms as candidates.
 */
export function resolveRoom(name: string, currentRoom?: Room | null): RoomResolution {
  // Strip a leading article/possessive the narrator may write ("the kitchen", "my bedroom") before
  // keying — a robustness nicety so "the Living Room" resolves like "living room".
  const key = normalizeRoomName(name).replace(/^(the|a|an|my|our|your|to|into|go-to|head-to|over-to)-/, "");
  if (key === "") return { kind: "unknown" };
  // 1. exact alias / room id.
  const alias = ROOM_ALIASES.get(key);
  if (alias) return { kind: "ok", room: alias };

  // 2. the ambiguous "bedroom" family — pick sensibly when we can, else report the candidates.
  const bedrooms: readonly Room[] = ["bedroom-a", "bedroom-b", "bedroom-c"];
  const isBedroomy = key === "bedroom" || key === "bedrooms" || key === "bed" || key === "room" || key === "beds";
  if (isBedroomy) {
    if (currentRoom && bedrooms.includes(currentRoom)) return { kind: "ok", room: currentRoom }; // already in one — stay
    const adjacentBedroom = currentRoom ? bedrooms.find((b) => areAdjacent(currentRoom, b)) : undefined;
    if (adjacentBedroom) return { kind: "ok", room: adjacentBedroom }; // step into the nearest bedroom
    return { kind: "ambiguous", candidates: bedrooms };
  }

  // 3. loose match against canonical names — flat-form prefix/substring AND token-by-token prefix, so
  //    "kit" → kitchen, "back yard" → backyard, "store room" → storage room (each typed token prefixes
  //    a room token in order). Forgiving without being reckless: a key token must PREFIX a room token.
  const flatKey = key.replace(/-/g, "");
  const keyTokens = key.split("-").filter(Boolean);
  const tokenPrefixMatch = (roomTokens: readonly string[]): boolean => {
    if (keyTokens.length > roomTokens.length) return false;
    return keyTokens.every((kt, i) => roomTokens[i]!.startsWith(kt) || kt.startsWith(roomTokens[i]!));
  };
  const matches = HOUSE_ROOMS.filter((r) => {
    const c = normalizeRoomName(r);
    const flatC = c.replace(/-/g, "");
    return (
      c.startsWith(key) || key.startsWith(c) ||
      flatC.startsWith(flatKey) || flatC.includes(flatKey) ||
      tokenPrefixMatch(c.split("-").filter(Boolean))
    );
  });
  const unique = [...new Set(matches)];
  if (unique.length === 1) return { kind: "ok", room: unique[0]! };
  if (unique.length > 1) {
    if (currentRoom) {
      const here = unique.includes(currentRoom) ? currentRoom : unique.find((r) => areAdjacent(currentRoom, r));
      if (here) return { kind: "ok", room: here };
    }
    return { kind: "ambiguous", candidates: unique };
  }
  return { kind: "unknown" };
}

export type Occupancy = ReadonlyMap<EntityId, Room>;

/**
 * The presence invariants (ADR 0003 §8 — people must make sense), as a checkable predicate:
 *  - every listed houseguest is in EXACTLY one room (Map shape guarantees ≤1; this checks =1);
 *  - movement from a previous assignment only crosses adjacency (or stays put).
 * Returns the violations so tests/checkpoints can name what broke.
 */
export function occupancyViolations(
  active: readonly EntityId[],
  occupancy: Occupancy,
  previous?: Occupancy,
): string[] {
  const problems: string[] = [];
  for (const id of active) {
    const room = occupancy.get(id);
    if (!room) { problems.push(`${id} occupies no room`); continue; }
    if (!HOUSE_ROOMS.includes(room)) problems.push(`${id} occupies unknown room ${room}`);
    const before = previous?.get(id);
    if (before && before !== room && !areAdjacent(before, room)) {
      problems.push(`${id} teleported ${before} → ${room}`);
    }
  }
  for (const id of occupancy.keys()) {
    if (!active.includes(id)) problems.push(`${id} occupies a room but is not active (evicted houseguests are nowhere)`);
  }
  return problems;
}
