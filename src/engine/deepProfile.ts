import type { EntityId } from "../domain/ids";
import type { PhysicalCharacteristics } from "../domain/physicalCharacteristics";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed } from "./characterFactory";
import type { Character, Houseguest } from "./characterFactory";

export type { PhysicalCharacteristics };

/**
 * Feature 0058 — deep character profiles ("born deep, persist, play out").
 *
 * PHASE 1 (this module): the DETERMINISTIC, seeded floor for the §3-depth profile, split across the
 * Vault Wall. From each houseguest's seed-stable Character it produces TWO things:
 *
 *   1. PUBLIC facets (`PublicDepth`) — a real multi-sentence `biography` (not a one-liner) + a
 *      STRUCTURED `physicalCharacteristics` facet (the single source of truth for BOTH the portrait
 *      prompt AND the text narration, L29/L23). These ride on the public, byte-stable `Character` and
 *      DO cross to the player.
 *
 *   2. HIDDEN profile (`DeepProfile`) — 2–3 secrets, the TRUE strategic goals, the named weakness /
 *      blind spot, and the Day-1 perception-of-the-player read. ENGINE-ONLY: it is sealed into the
 *      Vault and NEVER appears on any outward projection (the §8 Vault-Wall non-negotiable). It is a
 *      richer, structured sibling of the older `hiddenElements` (B50) — same discipline, more depth.
 *
 * DEFERRED to a later phase (seamed but not wired): the LLM authors these (endless variety) and writes
 * them BACK through `GameSession.recordCastProfile` — the engine then validates / repairs / splits /
 * seals (the 0051 portrait-prompt handshake mirror, ledger L28b). Phase 1 ships the deterministic
 * floor that is ALSO the offline fallback the engine validates LLM output against, plus the write-back
 * seam STUB. The portrait consumption (L29), the premiere voicing (L31), and FULL thread resolution
 * wiring are likewise phase 2 — Phase 1 seeds, seals, persists, and folds at least one thread.
 *
 * Determinism: every generator is driven by a SIDE rng hashed off the houseguest's name + seed, so it
 * never perturbs the main house stream (stats/names stay byte-stable, 0007) and the same seed yields
 * the same depth regardless of who the player is (L28 non-mirroring).
 *
 * No-leak discipline (CRITICAL): no PUBLIC facet string may serialize a banned stat KEY substring
 * ("physical"/"mental"/"social") or a bare float — the Vault scans hunt for `"physical":`-style keys
 * and floats. The public pools below are plain English with none of that vocabulary.
 */

// ── PUBLIC: the structured physical-characteristics facet (the ONE source of truth, L29/L23) ──────
// `PhysicalCharacteristics` is the pure DOMAIN type (`src/domain/physicalCharacteristics.ts`),
// re-exported above. Each axis is a short, gender-neutral English phrase; STRUCTURED so the portrait
// prompt and the narration read the SAME fields and never drift (distinct from the prose `appearance`).

/** The PUBLIC depth facets — ride on the byte-stable Character, cross to the player. */
export interface PublicDepth {
  /** A real multi-sentence backstory (not a one-liner) — the presentable parts. */
  biography: string;
  physicalCharacteristics: PhysicalCharacteristics;
}

// ── HIDDEN: the §3 profile that never crosses the wall ────────────────────────────────────────────
/** A Day-1 read of the player (v0 §10) — seeds the NPC→player edge. Hidden; no number ever shown. */
export interface DayOnePerception {
  /** A short clause: how this NPC reads the player at move-in (e.g. "harmless, socially useful"). */
  read: string;
  /** Signed seeds for the NPC→player edge (each in [-1,1]); folded into the move-in edge, never shown. */
  trustLean: number;
  affinityLean: number;
  threatLean: number;
}

/**
 * The full HIDDEN profile (0058 §3) — ENGINE-ONLY, sealed into the Vault, never on any outward
 * projection. A structured, deeper sibling of `hiddenElements` (B50). Seed-stable (part of the
 * baseline a houseguest is "born with"); folds into the hidden weights through the story threads.
 */
export interface DeepProfile {
  /** 2–3 real secrets — the kind that play out (financial desperation, a hidden alliance, a past). */
  secrets: string[];
  /** The TRUE strategic goals (distinct from the public persona's stated game). */
  trueGoals: string[];
  /** The named weakness / blind spot — a behavioral seed the game can exploit on a delay. */
  weakness: string;
  /** The Day-1 perception-of-the-player read (seeds the NPC→player edge). */
  dayOnePerception: DayOnePerception;
}

// ── A story thread (0058 §5) — the v0 §15 "Loose End" shape, Vault-sealed ─────────────────────────
export type ThreadStatus = "dormant" | "active" | "surfaced" | "resolved" | "expired";

/** The hidden-weight interaction nature a thread folds when it activates (a 0023 InteractionType). */
export type ThreadWeightImpact = "conflict" | "betrayal" | "alliance" | "bonding" | "strategy" | "gossip";

/**
 * A hidden dramatic thread derived from a character's secrets / weakness / goals. Sealed into the
 * Vault at seal time, persisted across restart, and folded into the relationship/soul layer when it
 * activates (reusing the 0023 consequence fold — NOT a parallel subsystem). Surfacing to others/the
 * player happens ONLY via in-game pathways (0002), never exposition.
 */
export interface StoryThread {
  /** Stable id within a season (so seal/persist/restore are idempotent). */
  id: string;
  /** The character the thread belongs to. */
  sourceId: EntityId;
  /** What the thread is about (the secret/weakness/goal it dramatizes). */
  premise: string;
  /** The game condition that activates/escalates it (prose; phase-2 wiring reads structured fields). */
  trigger: string;
  /** How it can become known — in-game pathways only (witnessed / told / overheard / gossip). */
  surfacingPathways: string[];
  /** The interaction nature whose hidden delta this thread folds when it activates (0023 kind). */
  weightImpact: ThreadWeightImpact;
  /** Lifecycle. Phase 1 seeds them `dormant`; the activation hook flips one to `active` and folds. */
  status: ThreadStatus;
}

// ── Deterministic PUBLIC generation ───────────────────────────────────────────────────────────────
// All pools are gender-neutral English with NO stat-key substring and NO float.

const HEIGHT_BUILD = [
  "tall and broad-shouldered", "short and compact", "average height, athletic",
  "lanky and rangy", "petite and slight", "stocky and powerful", "tall and willowy",
  "average height, soft and sturdy", "muscular and solid", "wiry and quick",
];
const SKIN_TONE = [
  "deep brown skin", "warm tan complexion", "fair freckled skin", "olive complexion",
  "rich dark complexion", "golden-brown skin", "pale rosy complexion", "amber-toned skin",
  "medium brown skin", "light olive complexion",
];
const HAIR_DESC = [
  "tight natural curls, jet black", "long dark waves", "a close-cropped fade",
  "a platinum-blond bob", "shoulder-length auburn hair", "a sleek black ponytail",
  "short copper-red hair", "a salt-and-pepper buzzcut", "loose chestnut curls",
  "braided dark hair", "a silver-streaked undercut", "honey-blond beach waves",
];
const FACIAL = [
  "strong cheekbones", "a square jaw and deep-set eyes", "round soft features",
  "a sharp angular face", "an open friendly face", "heavy expressive eyebrows",
  "a narrow refined face", "a warm crinkle-eyed smile", "an even symmetrical face",
  "a broad expressive grin",
];
const MARKS = [
  "a faint scar above one eyebrow", "a half-sleeve tattoo", "a beauty mark on one cheek",
  "freckles across the nose", "a small nose ring", "a gap-toothed grin",
  "none notable", "none notable", "wire-rimmed glasses", "a wrist tattoo",
];
const STYLE_DESC = [
  "streetwear and bold sneakers", "polished and camera-ready", "sporty and laid-back",
  "bohemian and layered", "sharp and put-together", "vintage thrift-store finds",
  "preppy and buttoned-up", "tattooed rocker edge", "beachy and sun-faded",
  "minimalist monochrome",
];

/** An age-look cue keyed off the houseguest's age band — keeps the look age-appropriate (0058 §3). */
export function ageLookFor(age: number): string {
  if (age < 25) return "youthful, early-twenties energy";
  if (age < 32) return "fresh-faced, late-twenties look";
  if (age < 40) return "settled, thirties presence";
  if (age < 50) return "weathered, forties gravitas";
  return "seasoned, distinguished older look";
}

/**
 * Deterministically build the structured physical facet for one houseguest off a SIDE rng. The
 * age-look reads the houseguest's PUBLIC age so words and picture agree (L29/L23).
 */
export function generatePhysicalCharacteristics(rng: RandomnessSource, age: number): PhysicalCharacteristics {
  return {
    heightBuild: rng.pick(HEIGHT_BUILD),
    skinTone: rng.pick(SKIN_TONE),
    hair: rng.pick(HAIR_DESC),
    facialFeatures: rng.pick(FACIAL),
    distinguishingMark: rng.pick(MARKS),
    ageLook: ageLookFor(age),
    style: rng.pick(STYLE_DESC),
  };
}

// A small set of biography roots/drives/closers — composed into a real multi-sentence backstory.
// PUBLIC: presentable life-outside material, NO stat vocabulary, NO float. Anchored to the public
// `background` line so the biography agrees with the already-shown persona facet.
const BIO_ROOTS = [
  "grew up in a big, loud family",
  "was raised by a single parent who worked two jobs",
  "left a small town the day after graduation",
  "came up through community college and grit",
  "spent years bouncing between cities before settling down",
  "was the quiet kid who learned to read a room",
  "built a life from scratch after a rough start",
  "comes from a tight-knit household with high expectations",
];
const BIO_DRIVES = [
  "and never stopped chasing something bigger",
  "and carries a quiet chip on the shoulder about it",
  "and learned early to count only on themselves",
  "and turned that hustle into a real career",
  "and still feels the pull of where they came from",
  "and wants to make the people back home proud",
];
const BIO_CLOSERS = [
  "Friends describe them as the one you call in a crisis.",
  "They say they applied on a dare and surprised themselves by getting cast.",
  "They have a life they put on hold for one wild summer.",
  "They are the first in their circle to ever do anything like this.",
  "They swear they are here for the experience, not just the money.",
  "They have something to prove and a quiet plan to do it.",
];

/**
 * Compose a real MULTI-SENTENCE biography from the public persona facet + the seeded roots. Two
 * sentences by construction (the §3 "real backstory, not a one-liner" requirement). Public, Vault-free.
 */
export function generateBiography(rng: RandomnessSource, c: Pick<Character, "background">): string {
  const who = c.background ? `Outside the house, they are ${c.background}` : "Outside the house, they had an ordinary life";
  const root = rng.pick(BIO_ROOTS);
  const drive = rng.pick(BIO_DRIVES);
  const closer = rng.pick(BIO_CLOSERS);
  return `${who} who ${root} ${drive}. ${closer}`;
}

// ── Deterministic HIDDEN generation (the §3 hidden half) ──────────────────────────────────────────
const SECRET_POOL = [
  "is in real financial trouble — the prize money is urgent, not aspirational",
  "is hiding a serious-superfan knowledge of the game behind a casual front",
  "has a past public failure they came here to redeem",
  "made a quiet pre-show promise to someone watching at home",
  "is nursing a grudge from outside the house they will never admit",
  "has a private health worry they keep hidden as a psychological edge",
  "is far lonelier than the confident persona lets on",
  "carries a family secret that shapes every move they make",
  "is playing for someone else entirely, not themselves",
  "has a temper they have learned to mostly contain",
];

// True strategic goals — distinct from a stated public game. No stat vocabulary.
const TRUE_GOAL_POOL = [
  "reach the end as a beloved player whose strategy stays invisible",
  "build one secret two-person final deal nobody sees coming",
  "let the loud players take the heat while quietly steering evictions",
  "neutralize the sharpest hidden threat before the jury phase",
  "win in a way the people back home can be proud of",
  "control the house through suggestion, never visible power",
  "get to the end against someone they can clearly beat",
  "stay off the radar until the numbers force a move",
];

// Named weaknesses / blind spots — behavioral seeds the game exploits on a delay.
const WEAKNESS_POOL = [
  "underestimates quiet players and reads them as non-threats too long",
  "cannot resist being the most relevant person in the room",
  "is too loyal once committed and finds it hard to cut anyone",
  "plays several moves ahead of where the house actually is",
  "lets a bruised ego drive decisions when challenged in public",
  "trusts a warm conversation far more than it has earned",
  "freezes under direct pressure and over-explains",
  "needs to be liked and folds when an alliance turns cold",
];

// Day-1 reads of the player + their signed leans for the NPC→player edge (never shown).
// BALANCED to net-zero on every axis (∑trust ≈ ∑affinity ≈ ∑threat ≈ 0) — the perception adds
// TEXTURE (some NPCs walk in warm, some wary), never a SYSTEMATIC tilt: a net-positive affinity/trust
// would quietly hand a passive player a friendlier jury and break the "finale wins must be earned"
// calibration gate (juryReach.property). Realistic too — a real cast doesn't uniformly like a stranger.
const PERCEPTION_POOL: ReadonlyArray<DayOnePerception> = [
  { read: "friendly, harmless, and socially useful — not a threat yet", trustLean: 0.3, affinityLean: 0.4, threatLean: -0.2 },
  { read: "warm and genuine beneath the surface — a possible ally", trustLean: 0.4, affinityLean: 0.5, threatLean: -0.1 },
  { read: "a fellow observer who sees too much — to be watched", trustLean: -0.2, affinityLean: 0.0, threatLean: 0.4 },
  { read: "rubbed them the wrong way on day one — wary and cool", trustLean: -0.4, affinityLean: -0.4, threatLean: 0.2 },
  { read: "guarded and hard to read — kept at arm's length", trustLean: -0.3, affinityLean: -0.3, threatLean: 0.1 },
  { read: "a likable rival who will have to go eventually", trustLean: 0.1, affinityLean: 0.2, threatLean: 0.4 },
  { read: "an unknown quantity worth a careful early read", trustLean: 0.0, affinityLean: 0.0, threatLean: 0.0 },
  { read: "cordial but kept at a polite distance — not close", trustLean: 0.0, affinityLean: -0.4, threatLean: -0.4 },
  { read: "easy to overlook — barely on the radar yet", trustLean: 0.0, affinityLean: 0.0, threatLean: -0.4 },
];

/** How many secrets each NPC carries (the §3 "2–3 secrets"). */
export const SECRET_RANGE = { min: 2, max: 3 } as const;

/**
 * Mint the full HIDDEN deep profile for one houseguest off a SIDE rng, so the main house stream stays
 * byte-stable. ENGINE-ONLY by construction — the caller seals it into the Vault and never projects it.
 * Deterministic per seed + player-independent (the name is player-independent).
 */
export function generateDeepProfile(rng: RandomnessSource): DeepProfile {
  const count = SECRET_RANGE.min + rng.int(SECRET_RANGE.max - SECRET_RANGE.min + 1); // 2..3
  const secrets = pickDistinct(rng, SECRET_POOL, count);
  const trueGoals = pickDistinct(rng, TRUE_GOAL_POOL, 2);
  const weakness = rng.pick(WEAKNESS_POOL);
  const p = PERCEPTION_POOL[rng.int(PERCEPTION_POOL.length)]!;
  return { secrets, trueGoals, weakness, dayOnePerception: { ...p } };
}

function pickDistinct(rng: RandomnessSource, pool: readonly string[], n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let guard = 0; out.length < n && guard < 200; guard++) {
    const v = rng.pick(pool);
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// ── Story-thread derivation (0058 §5) ─────────────────────────────────────────────────────────────
/** A surfacing pathway is always one of the in-game channels (0002) — never exposition. */
const PATHWAYS = ["witnessed", "told-by-confidant", "overheard", "gossip-diffused"] as const;

/**
 * Derive the hidden story threads from one NPC's deep profile (0058 §5). Each secret, the weakness,
 * and the first true goal becomes a `dormant` thread with a trigger, in-game surfacing pathways, and
 * the hidden-weight interaction it folds when it activates. Deterministic per seed.
 */
export function deriveStoryThreads(rng: RandomnessSource, sourceId: EntityId, profile: DeepProfile): StoryThread[] {
  const threads: StoryThread[] = [];
  let n = 0;
  const path = (): string[] => [PATHWAYS[rng.int(PATHWAYS.length)]!];
  for (const secret of profile.secrets) {
    threads.push({
      id: `thread:${sourceId}:${n++}`,
      sourceId,
      premise: `secret — ${secret}`,
      trigger: "activates when this houseguest is genuinely threatened on the block or cornered socially",
      surfacingPathways: path(),
      weightImpact: rng.next() < 0.5 ? "conflict" : "betrayal",
      status: "dormant",
    });
  }
  threads.push({
    id: `thread:${sourceId}:${n++}`,
    sourceId,
    premise: `weakness — ${profile.weakness}`,
    trigger: "fires when the game presents the exact situation this blind spot mishandles",
    surfacingPathways: path(),
    weightImpact: "strategy",
    status: "dormant",
  });
  if (profile.trueGoals[0]) {
    threads.push({
      id: `thread:${sourceId}:${n++}`,
      sourceId,
      premise: `true goal — ${profile.trueGoals[0]}`,
      trigger: "escalates as the house tightens and this goal demands a visible move",
      surfacingPathways: path(),
      weightImpact: "alliance",
      status: "dormant",
    });
  }
  return threads;
}

/**
 * The deterministic, engine-only DEEP layer for the whole cast (Phase 1 floor + offline fallback).
 * Built off the cast's drawn names + seed, so it is seed-stable and player-INDEPENDENT (the names are).
 * Returns, per NPC id: the PUBLIC depth facets (to fold onto the public Character) and the HIDDEN
 * profile + threads (to seal into the Vault). The caller owns the split across the wall.
 */
export interface CastDeepLayer {
  public: Record<EntityId, PublicDepth>;
  hidden: Record<EntityId, DeepProfile>;
  threads: StoryThread[];
}

export function generateCastDeepLayer(seed: number, npcs: readonly Houseguest[]): CastDeepLayer {
  const pub: Record<EntityId, PublicDepth> = {};
  const hidden: Record<EntityId, DeepProfile> = {};
  const threads: StoryThread[] = [];
  for (const hg of npcs) {
    const pubRng = new SeededRandom(hashSeed(`${seed}:deep-public:${hg.name}`));
    const hidRng = new SeededRandom(hashSeed(`${seed}:deep-hidden:${hg.name}`));
    const thrRng = new SeededRandom(hashSeed(`${seed}:deep-thread:${hg.name}`));
    pub[hg.id] = {
      biography: generateBiography(pubRng, hg.character),
      physicalCharacteristics: generatePhysicalCharacteristics(pubRng, hg.character.age),
    };
    const profile = generateDeepProfile(hidRng);
    hidden[hg.id] = profile;
    threads.push(...deriveStoryThreads(thrRng, hg.id, profile));
  }
  return { public: pub, hidden, threads };
}

// ── Vault sealing helpers (Phase 1: seed, seal, persist) ──────────────────────────────────────────
// Sealed under EXISTING HiddenKind values so the Vault store needs no schema change (the §3 hidden
// profile is a structured hidden attribute; a story thread is a hidden thread).
export const DEEP_PROFILE_KIND = "hidden-attribute" as const;
export const STORY_THREAD_KIND = "hidden-thread" as const;

/** Stable Vault id for one NPC's sealed deep profile (idempotent re-seal on restore). */
export function deepProfileVaultId(sourceId: EntityId): string {
  return `deep-profile:${sourceId}`;
}

/**
 * Serialize a hidden DeepProfile to ONE Vault record content string (engine-only — never projected).
 * The content embeds every secret/goal/weakness/perception so full-fidelity recall (L27b) can read it
 * back. Deterministic, so re-sealing on restore is idempotent.
 */
export function deepProfileToVaultContent(sourceId: EntityId, profile: DeepProfile): string {
  return [
    `deep-profile ${sourceId}`,
    `secrets: ${profile.secrets.join(" | ")}`,
    `true-goals: ${profile.trueGoals.join(" | ")}`,
    `weakness: ${profile.weakness}`,
    `day-1 read of player: ${profile.dayOnePerception.read}`,
  ].join("\n");
}

/** Serialize a story thread to ONE Vault record content string (engine-only). */
export function storyThreadToVaultContent(t: StoryThread): string {
  return [
    `story-thread ${t.id} [${t.status}]`,
    `premise: ${t.premise}`,
    `trigger: ${t.trigger}`,
    `surfaces via: ${t.surfacingPathways.join(", ")}`,
  ].join("\n");
}
