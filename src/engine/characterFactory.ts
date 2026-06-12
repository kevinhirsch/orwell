import { PLAYER, npc } from "../domain/ids";
import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { GIVEN_NAMES } from "./data/givenNames";
import { SURNAMES } from "./data/surnames";

/**
 * CharacterFactory + OOBE (feature 0004). Generates a curated, randomly-named
 * house of NPCs within plausible Big Brother archetype bounds, and runs the
 * first-run OOBE that produces the ONLY human-authored profile (the player).
 *
 * Names are SEEDED SAMPLES from vendored real-name corpora (E38 / product ruling #1,
 * 2026-06-10): the corpora are raw material only — no full-name+persona pairing is
 * hard-coded ("no fixed cast", the amended 0004 do-not), the legacy Bible's names stay
 * banned (excluded from the corpora, guarded by test), and identity never carries
 * across seeds. Each houseguest splits into a static `Character` (baseline) and a
 * dynamic `Soul` (evolving) per docs/decisions/0001 & 0002.
 */
export type Archetype =
  | "comp-beast" | "mastermind" | "social-butterfly" | "floater" | "villain"
  | "underdog" | "flirt" | "loyalist" | "wildcard" | "analyst" | "hothead" | "peacemaker";

export type StrategyStyle =
  | "aggressive" | "social" | "strategic" | "under-the-radar" | "emotional" | "loyal";

export type Disposition = "clash" | "bond" | "neutral";

interface ArchetypeSpec {
  archetype: Archetype;
  styles: StrategyStyle[];
  disposition: Disposition;
  bias: { physical: number; mental: number; social: number };
}

export const ARCHETYPES: readonly ArchetypeSpec[] = [
  { archetype: "comp-beast",       styles: ["aggressive", "strategic"],      disposition: "clash",   bias: { physical: 0.85, mental: 0.45, social: 0.45 } },
  { archetype: "mastermind",       styles: ["strategic", "under-the-radar"], disposition: "neutral", bias: { physical: 0.4,  mental: 0.85, social: 0.55 } },
  { archetype: "social-butterfly", styles: ["social", "emotional"],          disposition: "bond",    bias: { physical: 0.45, mental: 0.5,  social: 0.85 } },
  { archetype: "floater",          styles: ["under-the-radar", "social"],    disposition: "neutral", bias: { physical: 0.45, mental: 0.5,  social: 0.55 } },
  { archetype: "villain",          styles: ["aggressive", "strategic"],      disposition: "clash",   bias: { physical: 0.55, mental: 0.75, social: 0.5  } },
  { archetype: "underdog",         styles: ["emotional", "loyal"],           disposition: "bond",    bias: { physical: 0.45, mental: 0.5,  social: 0.55 } },
  { archetype: "flirt",            styles: ["social", "emotional"],          disposition: "bond",    bias: { physical: 0.5,  mental: 0.45, social: 0.8  } },
  { archetype: "loyalist",         styles: ["loyal", "social"],              disposition: "bond",    bias: { physical: 0.5,  mental: 0.5,  social: 0.65 } },
  { archetype: "wildcard",         styles: ["emotional", "aggressive"],      disposition: "clash",   bias: { physical: 0.6,  mental: 0.5,  social: 0.5  } },
  { archetype: "analyst",          styles: ["strategic", "under-the-radar"], disposition: "neutral", bias: { physical: 0.4,  mental: 0.8,  social: 0.5  } },
  { archetype: "hothead",          styles: ["aggressive", "emotional"],      disposition: "clash",   bias: { physical: 0.7,  mental: 0.4,  social: 0.45 } },
  { archetype: "peacemaker",       styles: ["loyal", "social"],              disposition: "bond",    bias: { physical: 0.45, mental: 0.55, social: 0.7  } },
];

const SPEC_OF = new Map<Archetype, ArchetypeSpec>(ARCHETYPES.map((s) => [s.archetype, s]));

export const CAST_SIZE = 16;
export const NPC_COUNT = 15;
export const ENSEMBLE = {
  MIN_DISTINCT_ARCHETYPES: 6,
  MIN_DISTINCT_STYLES: 4,
  MAX_PER_ARCHETYPE: 3,
} as const;

/**
 * A typed HIDDEN element of an NPC (queue item B50) — "tons of hidden elements" per the mandate.
 * Engine-side ONLY (it lives on the NPC's static Character, which the player projection never carries);
 * it surfaces RARELY into off-screen scene content (gated by `hiddenSurfaces`) and reaches the player
 * only if an in-game pathway later carries it (gossip / being told). Seed-stable (part of the static
 * character, 0007). Distinct from the dynamic Soul (0041 evolution): these are fixed secrets, not mood.
 */
export type HiddenElementKind = "secret-motive" | "pre-game-tie" | "concealed-aptitude" | "divergent-persona";
export interface HiddenElement {
  kind: HiddenElementKind;
  detail: string;
}

export interface Character {
  archetype: Archetype;
  strategyStyle: StrategyStyle;
  stats: { physical: number; mental: number; social: number };
  // --- Curated PUBLIC persona facets (0004 amendment + B61 cast voices) ---
  // Seed-stable, Vault-free: the things any houseguest can see/hear across the kitchen
  // counter — projected on the houseguest card as the narrator's voice anchor.
  // NOT aptitudes, NOT hidden attributes (those live in `hiddenElements`), NOT Soul content.
  background: string;
  appearance: string;
  age: number;
  presentation: string;
  /**
   * Seeded, typed HIDDEN elements (B50) — engine-side secrets the public persona may match or wildly
   * diverge from. NEVER projected to the player (the NPC card carries name + status only); they surface
   * rarely into hidden off-screen content and reach the player only via a pathway. Empty for the player
   * (their hidden material is the authored `privateStrategy`).
   */
  hiddenElements: HiddenElement[];
}

export interface Soul {
  emotionalBaseline: number;
  volatility: number;
  emotionalState: number;
  /** The persisted trajectory of `emotionalState` — the season arc (0041), monotonic (0007/0030). */
  emotionalHistory: number[];
  memory: string[];
}

export interface Houseguest {
  id: EntityId;
  name: string;
  authored: "generated";
  character: Character;
  soul: Soul;
}

export interface PlayerCharacter {
  id: EntityId;
  name: string;
  authored: "oobe";
  character: Character;
  /** The player has a dynamic Soul like any houseguest (initial: no relationship beliefs yet). */
  soul: Soul;
  /**
   * The player's OWN words for their public persona, as typed at OOBE — narrative/display only.
   * Free text (not constrained to the canonical archetype enum), so the game master can voice the
   * player exactly as they described themselves. The hidden `character.archetype`/`strategyStyle`
   * still drive STATS from a canonical spec (anti-sycophancy, 0006) — these never do.
   */
  persona?: { archetype?: string; strategyStyle?: string };
  /** Authored private material (secret strategy/targets) — DR-tagged NO_NPC_PATHWAY at game start. */
  privateStrategy?: string;
  /** Why they came to play (casting interview, 0050) — player-only authored material, never an NPC pathway. */
  motivation?: string;
  /**
   * True when the player never supplied a recognizable archetype and the engine DEFAULTED them
   * to the median spec (C6): surfaced on the casting card so an early/typo'd finalization is
   * visible, never a silent stat grant.
   */
  archetypeDefaulted?: boolean;
}

export interface GameHouse {
  player: PlayerCharacter;
  npcs: Houseguest[];
}

// --- Real-name sampling from vendored corpora (E38 / ruling #1 — never a fixed cast) ---

/** The vendored raw material (test seam): given names + surnames, never name+persona pairings. */
export const NAME_CORPORA = { given: GIVEN_NAMES, surnames: SURNAMES } as const;

/** The inverse realism gate (E38): every part of a generated display name is corpus-membered. */
export function isCorpusName(fullName: string): boolean {
  const parts = fullName.split(" ");
  if (parts.length !== 2) return false;
  return GIVEN_NAMES.includes(parts[0]!) && SURNAMES.includes(parts[1]!);
}

/**
 * Seeded sampling WITHOUT replacement per season: unique full names AND unique given names
 * within a house (the show never casts two same-named houseguests in a season). The corpora
 * are raw material — which name lands on which archetype is entirely the seed's draw.
 */
function uniqueName(rng: RandomnessSource, used: Set<string>, usedGiven: Set<string>): string {
  for (let guard = 0; guard < 1000; guard++) {
    const given = rng.pick(GIVEN_NAMES);
    const name = `${given} ${rng.pick(SURNAMES)}`;
    if (!used.has(name) && !usedGiven.has(given)) {
      used.add(name);
      usedGiven.add(given);
      return name;
    }
  }
  throw new Error("could not sample a unique name");
}

// --- Generation ---------------------------------------------------------------

function shuffled<T>(items: readonly T[], rng: RandomnessSource): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Curated draw: round-robin over a shuffled archetype pool → spread, no clumping. */
function curatedArchetypes(rng: RandomnessSource, count: number): ArchetypeSpec[] {
  const pool = shuffled(ARCHETYPES, rng);
  const out: ArchetypeSpec[] = [];
  for (let i = 0; out.length < count; i++) out.push(pool[i % pool.length]!);
  return out;
}

function jittered(bias: { physical: number; mental: number; social: number }, rng: RandomnessSource) {
  const j = (v: number): number => Math.max(0, Math.min(1, v + (rng.next() - 0.5) * 0.1));
  return { physical: j(bias.physical), mental: j(bias.mental), social: j(bias.social) };
}

const OCCUPATIONS = ["nurse", "bartender", "teacher", "athlete", "marketer", "chef", "engineer", "stylist", "realtor", "musician", "firefighter", "student", "barista", "trainer"];

// --- Public appearance generation (0004 amendment): seed-stable, Vault-free facets ---
// G24: the pools were 7×7×6 short phrases that said nothing about complexion, hair color,
// or distinguishing features — every unspecified slot fell to the image model's default
// face and the cast converged. Widened with the axes that most differentiate real faces;
// every entry is GENDER-NEUTRAL (names are sampled from a mixed-gender corpus with no
// gender tag, so no facet may assume one). Real BB casts are visibly diverse — complexion
// is a first-class facet, not an accident of the model's training prior.
const BUILDS = [
  "athletic", "lanky", "stocky", "willowy", "broad-shouldered", "petite", "average-build",
  "compact and muscular", "tall and rangy", "solidly built", "slender", "soft and sturdy",
];
const COMPLEXIONS = [
  "deep brown skin", "rich dark complexion", "warm brown skin", "olive complexion",
  "golden tan complexion", "light olive skin", "fair freckled skin", "pale complexion",
  "medium tan skin", "amber-toned complexion", "ebony complexion", "rosy fair skin",
];
const HAIR = [
  "close-cropped black hair", "long dark waves", "tight natural curls", "a platinum-blond bob",
  "shoulder-length auburn hair", "a sleek black ponytail", "short copper-red hair",
  "a salt-and-pepper buzzcut", "loose chestnut curls", "braided dark hair",
  "a silver-streaked undercut", "honey-blond beach waves", "jet-black slicked-back hair",
  "dyed teal-tipped hair",
];
const FEATURES = [
  "freckles across the nose", "a dimpled smile", "wire-rimmed glasses", "a small nose stud",
  "strong cheekbones", "a gap-toothed grin", "thick expressive eyebrows",
  "a faint scar above one eyebrow", "laugh lines", "a beauty mark on one cheek",
  "a square jawline", "round soft features",
];
const LOOKS = [
  "a warm smile", "a sharp gaze", "an easy grin", "a guarded expression", "bright eyes",
  "a confident stance", "a restless energy", "a calm, unhurried bearing",
];
const PRESENTATION = [
  "casual and laid-back", "polished and camera-ready", "sporty and energetic", "bohemian",
  "sharp and put-together", "approachable", "athleisure and gym energy",
  "vintage thrift-store style", "preppy and buttoned-up", "tattooed rocker edge",
  "beachy and sun-faded", "minimalist monochrome",
];

/** The facet pools, exported for the G24 variety tests (same precedent as NAME_CORPORA). */
export const APPEARANCE_POOLS = { BUILDS, COMPLEXIONS, HAIR, FEATURES, LOOKS, PRESENTATION } as const;

function generateAppearance(rng: RandomnessSource): { appearance: string; age: number; presentation: string } {
  // 21–52, skewed young (min of two draws): real casts cluster in the 20s–30s with a
  // genuine handful of 40s/50s — a flat band read as one generation of near-twins.
  const age = 21 + Math.min(rng.int(32), rng.int(32));
  return {
    age,
    presentation: rng.pick(PRESENTATION),
    appearance: `${rng.pick(BUILDS)}, ${rng.pick(COMPLEXIONS)}, ${rng.pick(HAIR)}, ${rng.pick(FEATURES)}, ${rng.pick(LOOKS)}`,
  };
}

// --- Hidden-element generation (B50): typed secrets, engine-side, surfacing rarely ---
const HIDDEN_ELEMENT_POOLS: Record<Exclude<HiddenElementKind, "concealed-aptitude">, readonly string[]> = {
  "secret-motive": [
    "is secretly playing to win money for someone back home",
    "is here for redemption after a public failure",
    "wants the fame far more than the prize",
    "has something to prove to a doubter watching at home",
    "is quietly desperate and will gamble bigger than they let on",
  ],
  "pre-game-tie": [
    "recognized another houseguest from before the show",
    "shares a hometown with someone in the house",
    "has a mutual friend with a rival they haven't admitted",
    "once crossed paths with a houseguest years ago",
    "made a quiet pre-show pact they intend to honor",
  ],
  "divergent-persona": [
    "plays sweet but keeps a private target list",
    "acts like a harmless floater while reading the whole house",
    "smiles through a grudge they will never forget",
    "seems naive but clocks every move",
    "looks fiercely loyal but will cut first when it counts",
  ],
};

/** Each concealed aptitude names the STAT that must back it (audit C9 — no unbackable flavor). */
export const CONCEALED_APTITUDES: ReadonlyArray<{ detail: string; stat: keyof StatProfile }> = [
  { detail: "is far sharper at puzzles than they pretend", stat: "mental" },
  { detail: "is a hidden endurance machine", stat: "physical" },
  { detail: "has a near-photographic memory", stat: "mental" },
  { detail: "is a closet strategist playing the fool", stat: "mental" },
  { detail: "is physically stronger than their frame suggests", stat: "physical" },
];

type StatProfile = { physical: number; mental: number; social: number };

/** The fit an NPC's secrets must respect (audit C9): their real stats + their PUBLIC archetype bias. */
export interface HiddenElementFit {
  stats: StatProfile;
  /** The public archetype's stat bias — what the house already EXPECTS of them across the counter. */
  publicBias: StatProfile;
}

/**
 * Internal-consistency gates for hidden elements (audit C9). A concealed aptitude must be REAL
 * (the actual hidden stat clears `statFloor`) and actually CONCEALED (the public archetype does
 * not already advertise that stat — its bias sits under `publicBiasCeiling`). At most ONE
 * secret-motive per NPC: a character cannot be simultaneously playing for redemption AND fame.
 */
export const HIDDEN_ELEMENT_GATES = {
  statFloor: 0.6,
  publicBiasCeiling: 0.65,
  maxSecretMotives: 1,
} as const;

const HIDDEN_KINDS: readonly HiddenElementKind[] = ["secret-motive", "pre-game-tie", "concealed-aptitude", "divergent-persona"];

/** How many hidden elements each NPC carries (the mandate's "tons", bounded for a season). */
export const HIDDEN_ELEMENT_RANGE = { min: 3, max: 6 } as const;

/**
 * Mint 3–6 DISTINCT, seeded, typed hidden elements for one NPC (B50). Driven by a SIDE rng (hashed off
 * the name) at generation so it never perturbs the main house stream (stats/names stay byte-stable, 0007).
 * With a `fit` (audit C9), the secrets are internally CONSISTENT: at most one secret-motive, and a
 * concealed aptitude only where the hidden stats genuinely back it AND the public persona conceals it.
 */
export function generateHiddenElements(rng: RandomnessSource, fit?: HiddenElementFit): HiddenElement[] {
  const count = HIDDEN_ELEMENT_RANGE.min + rng.int(HIDDEN_ELEMENT_RANGE.max - HIDDEN_ELEMENT_RANGE.min + 1); // 3..6
  const G = HIDDEN_ELEMENT_GATES;
  const aptitudes = CONCEALED_APTITUDES.filter((a) =>
    !fit || (fit.stats[a.stat] >= G.statFloor && fit.publicBias[a.stat] <= G.publicBiasCeiling));
  const out: HiddenElement[] = [];
  const seen = new Set<string>();
  let motives = 0;
  for (let attempts = 0; out.length < count && attempts < 200; attempts++) {
    const kind = rng.pick(HIDDEN_KINDS);
    let detail: string;
    if (kind === "concealed-aptitude") {
      if (aptitudes.length === 0) continue; // nothing backable/concealable — never mint flavor (C9)
      detail = aptitudes[rng.int(aptitudes.length)]!.detail;
    } else {
      if (kind === "secret-motive" && fit && motives >= G.maxSecretMotives) continue; // one motive max (C9)
      detail = rng.pick(HIDDEN_ELEMENT_POOLS[kind]);
    }
    const key = `${kind}::${detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind, detail });
      if (kind === "secret-motive") motives++;
    }
  }
  return out;
}

export function generateHouse(rng: RandomnessSource): { npcs: Houseguest[] } {
  const specs = curatedArchetypes(rng, NPC_COUNT);
  const used = new Set<string>();
  const usedGiven = new Set<string>();
  // Draw order on the MAIN stream (name, style, stats, background, volatility) is preserved exactly;
  // appearance is generated off a SIDE rng (hashed off the name) so the cosmetic 0004 amendment
  // never perturbs competition-relevant generation (keeps seeded house composition byte-stable).
  // (E38 re-baselined the seeded streams once — the name draw now consumes 2 picks, not phonemes —
  // and the side streams hash off the new names and re-derive, exactly as the audit specified.)
  const npcs: Houseguest[] = specs.map((spec, i) => {
    const name = uniqueName(rng, used, usedGiven);
    const strategyStyle = rng.pick(spec.styles);
    const stats = jittered(spec.bias, rng);
    const background = `a ${rng.pick(OCCUPATIONS)} who plays as a ${spec.archetype}`;
    const volatility = rng.next();
    return {
      id: npc(i + 1),
      name,
      authored: "generated" as const,
      character: {
        archetype: spec.archetype,
        strategyStyle,
        stats,
        background,
        ...generateAppearance(new SeededRandom(hashSeed(`${name}:${i}`))),
        // B50: minted off a SEPARATE side rng so the main stream stays byte-stable (engine-side secrets).
        // C9: minted against the NPC's REAL stats + PUBLIC archetype bias, so secrets stay consistent.
        hiddenElements: generateHiddenElements(
          new SeededRandom(hashSeed(`${name}:hidden:${i}`)),
          { stats, publicBias: spec.bias },
        ),
      },
      soul: { emotionalBaseline: 0.5, volatility, emotionalState: 0.5, emotionalHistory: [], memory: [] },
    };
  });
  return { npcs };
}

/** The OOBE intake — the only human-authored profile. `name` is required; the rest deepen it. */
export interface OobeInput {
  name: string;
  archetype?: Archetype;
  strategyStyle?: StrategyStyle;
  /** Optional authored backstory; deepens the static Character. */
  backstory?: string;
  /** Optional authored private strategy; becomes player-only knowledge (DR rule, 0013). */
  privateStrategy?: string;
  /**
   * The player's OWN words for their persona (free text, as typed) — kept for narrative even when
   * they don't match a canonical archetype/style. Display only; never feeds stats.
   */
  personaArchetype?: string;
  personaStrategyStyle?: string;
  /** Why they came to play (casting interview, 0050) — player-only; also seeds the Soul memory. */
  motivation?: string;
  /** Distilled get-to-know answers from the casting interview (0050) — seed the Soul memory. */
  interviewNotes?: string[];
}

/** Per-disposition emotional volatility seed (the emotional-modifier baseline, decision 0001). */
const VOL_OF: Record<Disposition, number> = { clash: 0.7, bond: 0.3, neutral: 0.5 };

/**
 * The MEDIAN default spec for a player who never supplied a recognizable archetype (C6):
 * the floater — balanced, unremarkable aptitudes. NEVER `ARCHETYPES[0]` (the comp-beast),
 * which silently granted a typo'd or early finalization the strongest stats in the game
 * (anti-sycophancy via fallback). Guarded by test: the default's stats are not the global max.
 */
export const DEFAULT_ARCHETYPE: Archetype = "floater";

/** The ONLY human-authored profile, produced at first-run character creation. */
export function runPlayerOOBE(input: OobeInput): PlayerCharacter {
  // Validation: a profile can't be half-authored. `name` is the required field.
  if (!input || typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("character creation requires a name");
  }
  const defaulted = !(input.archetype && SPEC_OF.has(input.archetype));
  const spec = defaulted ? SPEC_OF.get(DEFAULT_ARCHETYPE)! : SPEC_OF.get(input.archetype!)!;
  const strategyStyle = input.strategyStyle && spec.styles.includes(input.strategyStyle)
    ? input.strategyStyle : spec.styles[0]!;
  // The player's public appearance is seed-stable per authored name (the player has no NPC rng).
  const appearanceRng = new SeededRandom(hashSeed(input.name.trim()));
  // The casting interview seeds the Soul memory (0050): the house's long-term memory starts with
  // who the player said they were. These are the player's OWN pre-game memories — recallable and
  // persisted (0007/0030), never an NPC pathway (the interview is OOC; no one witnessed it).
  const interviewMemory = [
    ...(input.motivation?.trim() ? [`casting interview — why I came: ${input.motivation.trim()}`] : []),
    ...(input.interviewNotes ?? [])
      .map((n) => n.trim()).filter((n) => n.length > 0)
      .map((n) => `casting interview — ${n}`),
  ];
  return {
    id: PLAYER,
    name: input.name.trim(),
    authored: "oobe",
    character: {
      archetype: spec.archetype,
      strategyStyle,
      // Derived & balanced (anti-sycophancy, 0006): aptitudes come from the authored archetype,
      // NOT free allocation — so the player can never min-max past the NPC bounds.
      stats: { ...spec.bias },
      background: input.backstory?.trim() || "human-authored at first-run character creation (OOBE)",
      ...generateAppearance(appearanceRng),
      // The player authors their own hidden material (`privateStrategy`); the typed hidden-element pool
      // is for generated NPCs only, so the player's stays empty.
      hiddenElements: [],
    },
    soul: { emotionalBaseline: 0.5, volatility: VOL_OF[spec.disposition], emotionalState: 0.5, emotionalHistory: [], memory: interviewMemory },
    // The player's self-described persona (their words), kept for the narrative voice even when it
    // diverges from the canonical archetype/style that drive the hidden stats. Falls back to the
    // canonical labels so the view always has something to show.
    persona: {
      archetype: input.personaArchetype?.trim() || spec.archetype,
      strategyStyle: input.personaStrategyStyle?.trim() || strategyStyle,
    },
    ...(input.privateStrategy?.trim() ? { privateStrategy: input.privateStrategy.trim() } : {}),
    ...(input.motivation?.trim() ? { motivation: input.motivation.trim() } : {}),
    ...(defaulted ? { archetypeDefaulted: true } : {}),
  };
}

export function startNewGame(
  opts: {
    seed: number; playerName: string;
    archetype?: Archetype; strategyStyle?: StrategyStyle;
    /** The player's free-text persona words (display only; preserved even if not canonical). */
    personaArchetype?: string; personaStrategyStyle?: string;
    /** Casting-interview deepeners (0050): authored material that seeds Character/Soul. */
    backstory?: string; privateStrategy?: string; motivation?: string; interviewNotes?: string[];
  },
): GameHouse {
  const rng = new SeededRandom(opts.seed);
  const npcs = generateHouse(rng).npcs;
  const player = runPlayerOOBE({
    name: opts.playerName,
    ...(opts.archetype ? { archetype: opts.archetype } : {}),
    ...(opts.strategyStyle ? { strategyStyle: opts.strategyStyle } : {}),
    ...(opts.personaArchetype ? { personaArchetype: opts.personaArchetype } : {}),
    ...(opts.personaStrategyStyle ? { personaStrategyStyle: opts.personaStrategyStyle } : {}),
    ...(opts.backstory ? { backstory: opts.backstory } : {}),
    ...(opts.privateStrategy ? { privateStrategy: opts.privateStrategy } : {}),
    ...(opts.motivation ? { motivation: opts.motivation } : {}),
    ...(opts.interviewNotes ? { interviewNotes: opts.interviewNotes } : {}),
  });
  return { player, npcs };
}

// --- Helpers for the spec's invariants ----------------------------------------

export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function isPlausibleArchetype(a: string): a is Archetype {
  return SPEC_OF.has(a as Archetype);
}

export function dispositionOf(a: Archetype): Disposition {
  return SPEC_OF.get(a)!.disposition;
}

/**
 * The PUBLIC competitive menace of an archetype — its strongest aptitude bias (B55/audit C5).
 * Drives the move-in THREAT prior: a comp-beast LOOKS dangerous across the kitchen counter on
 * day one. Public-persona-derived only; the houseguest's actual hidden stats never inform it.
 */
export function archetypeMenace(a: Archetype): number {
  const b = SPEC_OF.get(a)!.bias;
  return Math.max(b.physical, b.mental, b.social);
}

const inUnit = (v: number): boolean => v >= 0 && v <= 1;

const JITTER = 0.05; // generateHouse's jittered() spread (±0.05), clamped to [0,1]

/** The aptitude range any generated houseguest can occupy (archetype bias ± jitter, clamped). */
export const NPC_STAT_RANGE: { min: number; max: number } = (() => {
  const all = ARCHETYPES.flatMap((s) => [s.bias.physical, s.bias.mental, s.bias.social]);
  return { min: Math.max(0, Math.min(...all) - JITTER), max: Math.min(1, Math.max(...all) + JITTER) };
})();

/** True iff the player's authored aptitudes sit within the cast's balanced bounds (no self-min-maxing). */
export function playerAptitudesWithinNpcBounds(p: PlayerCharacter): boolean {
  const { physical, mental, social } = p.character.stats;
  return [physical, mental, social].every((v) => v >= NPC_STAT_RANGE.min && v <= NPC_STAT_RANGE.max);
}

// --- The casting card (0050): qualitative reads only — words cross the wall, numbers never do ---

/** Every canonical strategy style, derived from the single source of truth (no hand-copied list). */
export const ALL_STRATEGY_STYLES: readonly StrategyStyle[] =
  [...new Set(ARCHETYPES.flatMap((s) => s.styles))];

export type StrengthTier = "standout" | "solid" | "scrappy";

/** The producer's read of one aptitude — a tier WORD derived from the hidden stat (0050 §5). */
export function strengthTier(v: number): StrengthTier {
  return v >= 0.7 ? "standout" : v >= 0.55 ? "solid" : "scrappy";
}

/** A Vault-free portrait descriptor (0020): PUBLIC facets only — never aptitudes, hidden, or Soul. */
export interface PortraitDescriptor {
  name: string;
  age: number;
  appearance: string;
  presentation: string;
  /** Archetype-as-vibe (public persona), never the numeric aptitudes behind it. */
  vibe: string;
}

/**
 * Build the portrait descriptor the front-end image-gen consumes. It draws ONLY on the
 * Character's public identity facets; it deliberately omits P/M/S aptitudes, hidden
 * attributes, and all Soul content — so a portrait can never leak secret state (0001/0020).
 */
export function portraitDescriptorFor(hg: { name: string; character: Character }): PortraitDescriptor {
  const c = hg.character;
  return {
    name: hg.name,
    age: c.age,
    appearance: c.appearance,
    presentation: c.presentation,
    vibe: `${c.archetype} energy, a ${c.strategyStyle} presence`,
  };
}

/** Internal-consistency / plausible-archetype ruleset the factory must honor. */
export function isPlausibleHouseguest(hg: Houseguest): boolean {
  const spec = SPEC_OF.get(hg.character.archetype);
  if (!spec) return false;
  if (!spec.styles.includes(hg.character.strategyStyle)) return false;
  const { physical, mental, social } = hg.character.stats;
  if (![physical, mental, social].every(inUnit)) return false;
  return hg.name.length > 0 && hg.character.background.length > 0;
}
