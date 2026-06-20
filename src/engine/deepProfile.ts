import type { EntityId } from "../domain/ids";
import type { PhysicalCharacteristics } from "../domain/physicalCharacteristics";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed } from "./characterFactory";
import type { Character, Houseguest } from "./characterFactory";
import { THREAD } from "./threadConstants";

export type { PhysicalCharacteristics };

/**
 * Feature 0058 — deep character profiles ("born deep, persist, play out").
 *
 * THIS module: the DETERMINISTIC, seeded floor for the §3-depth profile, split across the Vault Wall —
 * the offline fallback the engine validates LLM output against, and the live profile source when no
 * authoring model is wired. From each houseguest's seed-stable Character it produces TWO things:
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
 * Phase 2 is LIVE (no longer deferred): the LLM authors these (endless variety) and writes them BACK
 * through `GameSession.recordCastProfile` — the engine then validates / repairs / splits / seals (the
 * 0051 portrait-prompt handshake mirror, ledger L28b). The portrait consumption (L29 — the structured
 * physical facet feeds `castPortraitPrompts`), the premiere voicing (L31 — the public biography is
 * voiced through the `premiere` moment prompt), and the FULL thread trigger/resolution scheduler
 * (feature 0060 — `GameSessionAdapter.scheduleStoryThreads`, wired into the off-screen tick) are all
 * wired. This module remains the deterministic floor: it seeds, seals, persists, and the live scheduler
 * walks the threads dormant→active→surfaced→resolved→expired.
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
 * Feature 0060 §3 — the STRUCTURED, machine-evaluable trigger condition (a small closed enum, mirroring
 * `decisionConstants.ts`'s closed `NominationTactic`/disposition sets). It rides ALONGSIDE the prose
 * `trigger` (never replacing it — the prose stays for full-fidelity recall / narrator flavor, 0058 §6).
 * Each member is a GATE on when the world is ripe, evaluated against a Vault-free `SeasonPosition`
 * snapshot — never a content channel: the predicates read only PUBLIC position facts (nominations, week,
 * living-cast size, power holders, the engine's own relationship reads), never the thread premise.
 */
export type TriggerCondition =
  /** the source houseguest is currently nominated */
  | "on-block"
  /** the source has been on the block in ≥ THREAD.nominatedWeeksForRivalry distinct weeks */
  | "nominated-twice"
  /** the source's standing has dropped — bottom-quantile bond/threat read among the living house */
  | "cornered-socially"
  /** the living-cast count has fallen to ≤ THREAD.tightenCastSize */
  | "house-tightens"
  /** the source holds power this week (HOH / veto) — the goal demands a visible play */
  | "goal-demands-move";

export const TRIGGER_CONDITIONS: readonly TriggerCondition[] = [
  "on-block", "nominated-twice", "cornered-socially", "house-tightens", "goal-demands-move",
];

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
  /** The game condition that activates/escalates it (prose; the scheduler reads `triggerCondition`). */
  trigger: string;
  /**
   * Feature 0060 §3 — the STRUCTURED condition the scheduler evaluates each tick against the live,
   * Vault-free season position. Mapped from the source class (secret/weakness/goal) at derive time so
   * it agrees in spirit with the prose `trigger`. OPTIONAL on the type so a pre-0060 saved thread (no
   * structured field) loads cleanly; the engine defaults it by source class on restore (back-compat).
   */
  triggerCondition?: TriggerCondition;
  /** How it can become known — in-game pathways only (witnessed / told / overheard / gossip). */
  surfacingPathways: string[];
  /** The interaction nature whose hidden delta this thread folds when it activates (0023 kind). */
  weightImpact: ThreadWeightImpact;
  /** Lifecycle. Phase 1 seeds them `dormant`; the 0060 scheduler walks dormant→active→surfaced→resolved
   *  (or →expired). The status is persisted, so a driven thread survives a restart at its status (0030). */
  status: ThreadStatus;
  /**
   * Feature 0060 — the WEEK the thread last changed lifecycle (seeded at 0 on derive; set to the live
   * week on each transition). The scheduler reads it for the resolve/expire windows. Optional on the
   * type for pre-0060 back-compat; defaulted to the live week on restore when absent.
   */
  lifecycleWeek?: number;
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
// L41: the pools are deliberately LARGE and the cast deal is SPREAD-CAPPED (see MAX_PER_* below), so
// the hidden layer is as diverse as the public one — no single "secret mastermind"/"secretly clocking
// every move" trope can cluster across the cast (the 2026-06-19 finale-reveal defect). Mirrors the L28
// `spreadFacet`/`MAX_PER_*` discipline in characterFactory. Every entry is plain English: no banned
// stat-key substring (`"physical":`-style) and no bare float, so the §8 Vault scans stay clean.
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
  "told a flattering lie about their job that they now have to maintain",
  "is recently heartbroken and overcompensating with bravado",
  "has done this kind of high-pressure social game before, under another banner",
  "is quietly the most competitive person here and hides it behind charm",
  "owes someone on the outside and needs the win to make it right",
  "came in with a rival they recognized but is pretending they didn't",
  "is far more religious or principled than the party persona suggests",
  "has a soft spot that one specific archetype can exploit every time",
  "is documenting everyone for a tell-all they plan to write after",
  "secretly cannot stand the houseguest they are publicly closest to",
  "is younger or older than they let the house assume",
  "has a phobia or limit that a comp could expose at the worst moment",
  "is here mostly to prove something to a parent who doubted them",
  "made an off-camera alliance pact in the sequester hotel already",
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
  "be the obvious leader and dare the house to take the shot",
  "collect every secret in the house and trade them like currency",
  "run a loud decoy game while a quiet one does the real work",
  "win enough comps that they never have to rely on anyone",
  "play an emotional, loyalty-first game and make the jury love them",
  "engineer a big blindside early to set the house's fear of them",
  "ride a strong shield as far as it lasts, then cut it clean",
  "flip whichever way the numbers point and never hold a grudge",
  "protect one specific person to the end, even past their own game",
  "avoid blood on their hands and let others do every eviction",
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
  "talks too much when nervous and leaks their own plans",
  "holds grudges and lets revenge override the smart move",
  "is so conflict-averse they let others make their decisions",
  "overestimates their own social read and gets blindsided",
  "gets attached fast and cannot play against people they like",
  "chases comp wins for the spotlight even when laying low is smarter",
  "believes their own cover story and forgets who they're lying to",
  "panics at the first sign of being on the wrong side of the house",
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

// L41 — cast-wide SPREAD CAPS: across the 15-cast, no secret/goal/weakness/Day-1-read may be shared by
// more than this many houseguests. Sized so the pools comfortably satisfy a 15-cast (the relaxation
// path is unreachable in practice but never spins). The same discipline as L28's MAX_PER_BUILD.
export const MAX_PER_SECRET = 2;
export const MAX_PER_GOAL = 3;
export const MAX_PER_WEAKNESS = 2;
export const MAX_PER_PERCEPTION = 3;

/**
 * The mutable usage tallies that enforce the L41 cast-wide spread caps as `generateCastDeepLayer` deals
 * one NPC at a time. Keyed by the drawn string (the perception by its `read`). Pass the SAME object to
 * every NPC's `generateDeepProfile` so a trope used to its cap is no longer offered to later NPCs.
 */
export interface CastSpreadCaps {
  secretUses: Map<string, number>;
  goalUses: Map<string, number>;
  weaknessUses: Map<string, number>;
  perceptionUses: Map<string, number>;
}

export function newCastSpreadCaps(): CastSpreadCaps {
  return { secretUses: new Map(), goalUses: new Map(), weaknessUses: new Map(), perceptionUses: new Map() };
}

/**
 * Mint the full HIDDEN deep profile for one houseguest off a SIDE rng, so the main house stream stays
 * byte-stable. ENGINE-ONLY by construction — the caller seals it into the Vault and never projects it.
 * Deterministic per seed + player-independent (the name is player-independent). When `caps` is supplied
 * (the cast-wide path) the draws honor the L41 spread caps; without it (a single standalone profile)
 * the draws are uncapped.
 */
export function generateDeepProfile(rng: RandomnessSource, caps?: CastSpreadCaps): DeepProfile {
  const count = SECRET_RANGE.min + rng.int(SECRET_RANGE.max - SECRET_RANGE.min + 1); // 2..3
  if (caps) {
    const secrets = pickDistinctCapped(rng, SECRET_POOL, count, caps.secretUses, MAX_PER_SECRET);
    const trueGoals = pickDistinctCapped(rng, TRUE_GOAL_POOL, 2, caps.goalUses, MAX_PER_GOAL);
    const weakness = pickCapped(rng, WEAKNESS_POOL, caps.weaknessUses, MAX_PER_WEAKNESS);
    const p = pickPerceptionCapped(rng, caps.perceptionUses, MAX_PER_PERCEPTION);
    return { secrets, trueGoals, weakness, dayOnePerception: { ...p } };
  }
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

/** Draw one value honoring the cast-wide cap; relaxes the cap rather than spinning if it can't be met. */
function pickCapped(rng: RandomnessSource, pool: readonly string[], uses: Map<string, number>, maxEach: number): string {
  for (let g = 0; g < 400; g++) {
    const v = rng.pick(pool);
    if ((uses.get(v) ?? 0) < maxEach) { uses.set(v, (uses.get(v) ?? 0) + 1); return v; }
  }
  const v = rng.pick(pool);
  uses.set(v, (uses.get(v) ?? 0) + 1);
  return v;
}

/** Pick `n` values distinct WITHIN this profile AND honoring the cast-wide cap; relaxes if it must. */
function pickDistinctCapped(rng: RandomnessSource, pool: readonly string[], n: number, uses: Map<string, number>, maxEach: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let guard = 0; out.length < n && guard < 400; guard++) {
    const v = rng.pick(pool);
    if (seen.has(v) || (uses.get(v) ?? 0) >= maxEach) continue;
    seen.add(v); uses.set(v, (uses.get(v) ?? 0) + 1); out.push(v);
  }
  // Relaxation: if the cap-and-distinct constraint could not fill, take distinct-only (never spin).
  for (let guard = 0; out.length < n && guard < 400; guard++) {
    const v = rng.pick(pool);
    if (seen.has(v)) continue;
    seen.add(v); uses.set(v, (uses.get(v) ?? 0) + 1); out.push(v);
  }
  return out;
}

/** Perception is an object pool; cap by its `read`. Keeps the pool's net-zero balance (contents fixed). */
function pickPerceptionCapped(rng: RandomnessSource, uses: Map<string, number>, maxEach: number): DayOnePerception {
  for (let g = 0; g < 400; g++) {
    const p = PERCEPTION_POOL[rng.int(PERCEPTION_POOL.length)]!;
    if ((uses.get(p.read) ?? 0) < maxEach) { uses.set(p.read, (uses.get(p.read) ?? 0) + 1); return p; }
  }
  const p = PERCEPTION_POOL[rng.int(PERCEPTION_POOL.length)]!;
  uses.set(p.read, (uses.get(p.read) ?? 0) + 1);
  return p;
}

// ── Story-thread derivation (0058 §5 / 0060 §3) ───────────────────────────────────────────────────
/** A surfacing pathway is always one of the in-game channels (0002) — never exposition. */
const PATHWAYS = ["witnessed", "told-by-confidant", "overheard", "gossip-diffused"] as const;

/** The thread's SOURCE class — which half of the deep profile minted it (0060 §3 condition mapping). */
export type ThreadSourceClass = "secret" | "weakness" | "goal";

// 0060 §3 — each source class maps to a small set of structured conditions; the prose `trigger` lines
// map cleanly onto these. The scheduler picks one deterministically off the same side rng, so the
// choice is seed-stable and agrees in spirit with the prose line.
const CONDITIONS_BY_CLASS: Record<ThreadSourceClass, readonly TriggerCondition[]> = {
  secret: ["on-block", "cornered-socially", "nominated-twice"],
  weakness: ["cornered-socially", "goal-demands-move"],
  goal: ["house-tightens", "goal-demands-move"],
};

/**
 * 0060 §3 back-compat: the default structured condition for a thread that has none (a pre-0060 save, or
 * a thread whose class can't be re-derived). Inferred from the thread's `premise` prefix (`secret —` /
 * `weakness —` / `true goal —`), so the re-derive on restore is idempotent and seed-free. Deterministic
 * (no rng): a fixed representative per class — the FIRST of that class's list.
 */
export function defaultTriggerConditionFor(thread: Pick<StoryThread, "premise">): TriggerCondition {
  const cls: ThreadSourceClass = thread.premise.startsWith("weakness")
    ? "weakness"
    : thread.premise.startsWith("true goal")
      ? "goal"
      : "secret";
  return CONDITIONS_BY_CLASS[cls][0]!;
}

/**
 * Derive the hidden story threads from one NPC's deep profile (0058 §5). Each secret, the weakness,
 * and the first true goal becomes a `dormant` thread with a prose trigger, a STRUCTURED `triggerCondition`
 * (0060 §3), in-game surfacing pathways, and the hidden-weight interaction it folds on activation.
 * Deterministic per seed.
 */
export function deriveStoryThreads(rng: RandomnessSource, sourceId: EntityId, profile: DeepProfile): StoryThread[] {
  const threads: StoryThread[] = [];
  let n = 0;
  const path = (): string[] => [PATHWAYS[rng.int(PATHWAYS.length)]!];
  const condFor = (cls: ThreadSourceClass): TriggerCondition => {
    const pool = CONDITIONS_BY_CLASS[cls];
    return pool[rng.int(pool.length)]!;
  };
  for (const secret of profile.secrets) {
    threads.push({
      id: `thread:${sourceId}:${n++}`,
      sourceId,
      premise: `secret — ${secret}`,
      trigger: "activates when this houseguest is genuinely threatened on the block or cornered socially",
      triggerCondition: condFor("secret"),
      surfacingPathways: path(),
      weightImpact: rng.next() < 0.5 ? "conflict" : "betrayal",
      status: "dormant",
      lifecycleWeek: 0,
    });
  }
  threads.push({
    id: `thread:${sourceId}:${n++}`,
    sourceId,
    premise: `weakness — ${profile.weakness}`,
    trigger: "fires when the game presents the exact situation this blind spot mishandles",
    triggerCondition: condFor("weakness"),
    surfacingPathways: path(),
    weightImpact: "strategy",
    status: "dormant",
    lifecycleWeek: 0,
  });
  if (profile.trueGoals[0]) {
    threads.push({
      id: `thread:${sourceId}:${n++}`,
      sourceId,
      premise: `true goal — ${profile.trueGoals[0]}`,
      trigger: "escalates as the house tightens and this goal demands a visible move",
      triggerCondition: condFor("goal"),
      surfacingPathways: path(),
      weightImpact: "alliance",
      status: "dormant",
      lifecycleWeek: 0,
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
  // L41: one shared cap tally for the whole cast — so a secret/goal/weakness/read used to its cap is
  // not offered to the remaining houseguests. Deterministic: the cast iteration order is seed-stable.
  const caps = newCastSpreadCaps();
  for (const hg of npcs) {
    const pubRng = new SeededRandom(hashSeed(`${seed}:deep-public:${hg.name}`));
    const hidRng = new SeededRandom(hashSeed(`${seed}:deep-hidden:${hg.name}`));
    const thrRng = new SeededRandom(hashSeed(`${seed}:deep-thread:${hg.name}`));
    pub[hg.id] = {
      biography: generateBiography(pubRng, hg.character),
      physicalCharacteristics: generatePhysicalCharacteristics(pubRng, hg.character.age),
    };
    const profile = generateDeepProfile(hidRng, caps);
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
    `trigger: ${t.trigger}` + (t.triggerCondition ? ` (${t.triggerCondition})` : ""),
    `surfaces via: ${t.surfacingPathways.join(", ")}`,
  ].join("\n");
}

// ── Post-season retrospective rendering (0048 — the Wall's ONE sanctioned reveal) ──────────────────
// `storyThreadToVaultContent` above is the engine-only AUDIT serialization (machine ids + slugs — fine,
// the Vault is engine-only). It is NOT player-readable, so the 0048 retrospective must NOT show it raw
// (the live repro: "[hidden-thread] story-thread thread:npc:8:0 [dormant] premise: secret — …"). These
// helpers render the SAME thread as plain, name-resolved prose for that post-season unsealing — the
// machine thread id (`thread:npc:N:M`) is dropped entirely (its `npc:N` is resolved to the source's
// NAME), the status / trigger-condition / surfacing-pathway slugs become readable clauses, and the
// premise's `secret —`/`weakness —`/`true goal —` tag becomes a natural lead. Pure / Vault-free.

/** A thread's lifecycle status as a readable post-season clause (or "" for the live `active` middle). */
function threadStatusClause(status: ThreadStatus): string {
  switch (status) {
    case "dormant":
      return "never surfaced";
    case "active":
      return "in play but never broke into the open";
    case "surfaced":
      return "broke into the open";
    case "resolved":
      return "played out";
    case "expired":
      return "passed without ever landing";
    default:
      return "";
  }
}

/** Turn the premise tag (`secret — …` / `weakness — …` / `true goal — …`) into a natural lead. */
function premiseLead(premise: string): string {
  const m = /^(secret|weakness|true goal)\s*—\s*(.*)$/s.exec(premise);
  if (!m) return premise.trim();
  const body = m[2]!.trim();
  // The premise bodies are authored as bare predicates ("is hiding …", "talks too much …", "protect …"),
  // so the lead doubles as the sentence subject's continuation (the source NAME is prepended by the
  // caller): "<Name> — Secretly was hiding …".
  switch (m[1]) {
    case "secret":
      return `Secretly ${body}`;
    case "weakness":
      return `Their blind spot — ${body}`;
    case "true goal":
      return `Their real game — ${body}`;
    default:
      return body;
  }
}

/**
 * Render ONE hidden story thread as readable post-season prose, the source id resolved to a name via
 * `nameOf` (a public roster fact). Contains ZERO raw `npc:N` / `thread:` token by construction — the
 * machine id is never interpolated; only the resolved source NAME and translated clauses are. The
 * premise text (the good part) is preserved verbatim after its tag is naturalized.
 */
export function storyThreadToRetrospectiveProse(t: StoryThread, nameOf: (id: EntityId) => string): string {
  const name = nameOf(t.sourceId);
  const lead = premiseLead(t.premise);
  const status = threadStatusClause(t.status);
  const tail = status ? ` (${status})` : "";
  return `${name} — ${lead}${tail}`;
}

// ── 0060 — the scheduler's PURE support (the season-position predicates + the Vault-safe paraphrase) ─
// All of this is engine-only and Vault-free BY CONSTRUCTION: the predicates read only PUBLIC position
// facts, and the paraphrase is a vague atmospheric gloss keyed by SOURCE CLASS — it never touches the
// thread premise/trigger string, so the §7 leak-sweep stays strict about exact secret text. The
// orchestration (which thread, which roll) lives in `GameSessionAdapter.scheduleStoryThreads`.

/**
 * A Vault-FREE snapshot of the live season position the scheduler evaluates a thread's `triggerCondition`
 * against (0060 §3). Every field is a PUBLIC/engine-internal POSITION fact (who's nominated, the week,
 * the living-cast size, who holds power, the engine's own relationship reads) — never a thread premise.
 * A predicate is a gate on when the world is RIPE, never a content channel.
 */
export interface SeasonPosition {
  /** The current week (1-based once the game is live). */
  week: number;
  /** Living-cast count (player + non-evicted NPCs). */
  livingCount: number;
  /** Currently nominated houseguests. */
  nominees: ReadonlySet<EntityId>;
  /** The current power holders this week (HOH and/or veto holder). */
  powerHolders: ReadonlySet<EntityId>;
  /** Sources whose bond standing is in the bottom quantile of the living house (THREAD.corneredBottomQuantile). */
  cornered: ReadonlySet<EntityId>;
  /** Sources who have been on the block in ≥ THREAD.nominatedWeeksForRivalry distinct weeks. */
  nominatedRepeatedly: ReadonlySet<EntityId>;
  /** Whether the source has been evicted (its trigger window is closed — drives expiry). */
  evicted: ReadonlySet<EntityId>;
}

/**
 * Is a thread's STRUCTURED trigger condition met by the live season position (0060 §3)? Pure; reads only
 * the Vault-free `SeasonPosition`. A thread with no structured condition (pre-0060) is treated as its
 * class default before this is called (the adapter back-fills on restore), so `condition` is required.
 */
export function triggerMet(thread: StoryThread, pos: SeasonPosition): boolean {
  const cond = thread.triggerCondition ?? defaultTriggerConditionFor(thread);
  const src = thread.sourceId;
  switch (cond) {
    case "on-block":
      return pos.nominees.has(src);
    case "nominated-twice":
      return pos.nominatedRepeatedly.has(src);
    case "cornered-socially":
      return pos.cornered.has(src);
    case "house-tightens":
      return pos.livingCount <= THREAD.tightenCastSize;
    case "goal-demands-move":
      return pos.powerHolders.has(src);
    default:
      return false;
  }
}

/** Has a thread's source left the game (its trigger window is closed — drives the 0060 §4.4 expiry)? */
export function sourceWindowClosed(thread: StoryThread, pos: SeasonPosition): boolean {
  return pos.evicted.has(thread.sourceId);
}

// The vague atmospheric gloss a surfacing thread becomes (0060 §4.2 / §7) — keyed by SOURCE CLASS, NEVER
// the premise. This is the thread analogue of gossip's `RUMOR_GLOSS`: a belief-level paraphrase that
// shapes atmosphere, not a fact-on-a-projection and not an exposition line. No secret/trigger text here.
const THREAD_GLOSS: Record<ThreadSourceClass, string> = {
  secret: "is carrying something they're not telling anyone",
  weakness: "has a blind spot the house could play on",
  goal: "is quietly playing a bigger game than they let on",
};

function threadSourceClass(thread: Pick<StoryThread, "premise">): ThreadSourceClass {
  return thread.premise.startsWith("weakness")
    ? "weakness"
    : thread.premise.startsWith("true goal")
      ? "goal"
      : "secret";
}

/**
 * The vague paraphrase a surfacing thread gives rise to (0060 §4.2): a belief about the SOURCE keyed by
 * the thread's class — NEVER the verbatim premise/trigger, so the 0031/0060 §7 leak sweep can stay
 * strict about exact secret strings. `name` is the public name of the source (a public fact). The
 * result reads like a rumor a houseguest could hold with source + confidence.
 */
export function threadRumor(thread: StoryThread, name: string): string {
  return `there's a feeling around the house that ${name} ${THREAD_GLOSS[threadSourceClass(thread)]}`;
}
