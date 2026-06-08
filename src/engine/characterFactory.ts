import { PLAYER, npc } from "../domain/ids";
import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";

/**
 * CharacterFactory + OOBE (feature 0004). Generates a curated, randomly-named
 * house of NPCs within plausible Big Brother archetype bounds, and runs the
 * first-run OOBE that produces the ONLY human-authored profile (the player).
 *
 * Names are SYNTHESIZED from phonemes — never drawn from a hard-coded roster or
 * sample-save content. Each houseguest splits into a static `Character` (baseline)
 * and a dynamic `Soul` (evolving) per docs/decisions/0001 & 0002.
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

export interface Character {
  archetype: Archetype;
  strategyStyle: StrategyStyle;
  stats: { physical: number; mental: number; social: number };
  background: string;
}

export interface Soul {
  emotionalBaseline: number;
  volatility: number;
  emotionalState: number;
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
  /** Authored private material (secret strategy/targets) — DR-tagged NO_NPC_PATHWAY at game start. */
  privateStrategy?: string;
}

export interface GameHouse {
  player: PlayerCharacter;
  npcs: Houseguest[];
}

// --- Procedural, phoneme-based naming (NEVER a hard-coded name roster) --------

const ONSET = ["br", "k", "j", "m", "t", "sh", "r", "l", "d", "ka", "ne", "va", "z", "mi", "el", "ar", "be", "ca", "fa", "gi", "ho", "ju", "lo", "ma", "na", "pe", "sy", "tor"];
const NUCLEUS = ["a", "e", "i", "o", "u", "ai", "ee", "ia", "ou", "ay"];
const CODA = ["n", "l", "r", "s", "th", "ne", "ra", "den", "lyn", "son", "ka", "mir", "sa", ""];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function namePart(rng: RandomnessSource): string {
  const syll = (): string => rng.pick(ONSET) + rng.pick(NUCLEUS) + rng.pick(CODA);
  let s = syll();
  if (rng.next() < 0.6) s += syll();
  return cap(s);
}

function uniqueName(rng: RandomnessSource, used: Set<string>): string {
  for (let guard = 0; guard < 1000; guard++) {
    const name = `${namePart(rng)} ${namePart(rng)}`;
    if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name) && !used.has(name)) {
      used.add(name);
      return name;
    }
  }
  throw new Error("could not synthesize a unique name");
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

export function generateHouse(rng: RandomnessSource): { npcs: Houseguest[] } {
  const specs = curatedArchetypes(rng, NPC_COUNT);
  const used = new Set<string>();
  const npcs: Houseguest[] = specs.map((spec, i) => ({
    id: npc(i + 1),
    name: uniqueName(rng, used),
    authored: "generated" as const,
    character: {
      archetype: spec.archetype,
      strategyStyle: rng.pick(spec.styles),
      stats: jittered(spec.bias, rng),
      background: `a ${rng.pick(OCCUPATIONS)} who plays as a ${spec.archetype}`,
    },
    soul: { emotionalBaseline: 0.5, volatility: rng.next(), emotionalState: 0.5, memory: [] },
  }));
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
}

/** Per-disposition emotional volatility seed (the emotional-modifier baseline, decision 0001). */
const VOL_OF: Record<Disposition, number> = { clash: 0.7, bond: 0.3, neutral: 0.5 };

/** The ONLY human-authored profile, produced at first-run character creation. */
export function runPlayerOOBE(input: OobeInput): PlayerCharacter {
  // Validation: a profile can't be half-authored. `name` is the required field.
  if (!input || typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("character creation requires a name");
  }
  const spec = (input.archetype && SPEC_OF.get(input.archetype)) || ARCHETYPES[0]!;
  const strategyStyle = input.strategyStyle && spec.styles.includes(input.strategyStyle)
    ? input.strategyStyle : spec.styles[0]!;
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
    },
    soul: { emotionalBaseline: 0.5, volatility: VOL_OF[spec.disposition], emotionalState: 0.5, memory: [] },
    ...(input.privateStrategy?.trim() ? { privateStrategy: input.privateStrategy.trim() } : {}),
  };
}

export function startNewGame(
  opts: { seed: number; playerName: string; archetype?: Archetype; strategyStyle?: StrategyStyle },
): GameHouse {
  const rng = new SeededRandom(opts.seed);
  const npcs = generateHouse(rng).npcs;
  const player = runPlayerOOBE({
    name: opts.playerName,
    ...(opts.archetype ? { archetype: opts.archetype } : {}),
    ...(opts.strategyStyle ? { strategyStyle: opts.strategyStyle } : {}),
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

/** Internal-consistency / plausible-archetype ruleset the factory must honor. */
export function isPlausibleHouseguest(hg: Houseguest): boolean {
  const spec = SPEC_OF.get(hg.character.archetype);
  if (!spec) return false;
  if (!spec.styles.includes(hg.character.strategyStyle)) return false;
  const { physical, mental, social } = hg.character.stats;
  if (![physical, mental, social].every(inUnit)) return false;
  return hg.name.length > 0 && hg.character.background.length > 0;
}
