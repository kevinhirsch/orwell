import type { CompetitionDef, CompetitionFormat, CompetitionPhase } from "./competitionLibrary";
import { hashSeed } from "./characterFactory";

/**
 * Feature 0125 — the competition THEME layer: a large, seeded pool of Vault-free "skins" laid over the
 * 0042 mechanic library so a whole season can run without a repeated competition, even when the same
 * MECHANIC recurs (an endurance comp reskinned as "Zero-Gravity Endurance" one week and "Haunted
 * Endurance" the next). A theme is pure NARRATION flavor — a name transform + a scene-setter woven into
 * the premise. It NEVER touches resolution: the mechanic (and thus which stat governs and who wins) is
 * unchanged, and the theme is chosen on a DEDICATED, deterministic hash — never the beat rng — so the
 * seeded game spine (juryReach / golden / UAT) is byte-identical whether themes are on or off.
 *
 * mechanic (0042, ~6 per phase) × theme (this pool, 24) ⇒ 100s of visibly distinct competitions, drawn
 * from a seeded per-phase PERMUTATION so no theme repeats within a phase until the pool is exhausted
 * (24 weeks >> an 11-week season). Tunable content, like the library / the temperature constants: add or
 * reword themes freely — the tests pin the STRUCTURE (no-repeat, determinism, Vault-free, floor unchanged),
 * not the flavor. The theme is the deterministic FLOOR the narrator dresses; #1400's model-authored
 * competition fiction still overrides it when generation is on.
 */
export interface CompetitionTheme {
  id: string;
  /** Display label — the theme's setting ("Outer Space", "Haunted House"). */
  label: string;
  /** Adjectival title fragment that composes into the comp name ("Zero-Gravity", "Haunted"). */
  prefix: string;
  /** A scene-setter sentence woven ahead of the mechanic's own premise. Vault-free flavor only. */
  setting: string;
}

/** How each mechanic FORMAT reads as a noun in a themed comp title. */
export const FORMAT_NOUN: Record<CompetitionFormat, string> = {
  endurance: "Endurance",
  puzzle: "Puzzle",
  quiz: "Trivia",
  skill: "Challenge",
  crapshoot: "Scramble",
  social: "Mind Games",
};

export const COMPETITION_THEMES: CompetitionTheme[] = [
  { id: "space", label: "Outer Space", prefix: "Zero-Gravity", setting: "The yard has been rebuilt as a derelict space station strung with wires and warning lights." },
  { id: "haunt", label: "Haunted House", prefix: "Haunted", setting: "Fog rolls across a graveyard set and something keeps groaning in the dark." },
  { id: "winter", label: "Winter Wonderland", prefix: "Frostbitten", setting: "The whole yard is a frozen tundra of fake snow, icicles, and a biting wind machine." },
  { id: "casino", label: "Casino Royale", prefix: "High-Roller", setting: "Neon slot machines and felt tables turn the living room into a midnight casino floor." },
  { id: "candy", label: "Candy Land", prefix: "Sugar-Rush", setting: "Giant lollipops and gumdrop mountains make the set look edible enough to bite." },
  { id: "west", label: "Wild West", prefix: "Frontier", setting: "A dusty saloon-town has been raised in the backyard, tumbleweeds and all." },
  { id: "sea", label: "Under the Sea", prefix: "Deep-Sea", setting: "Bubble curtains and drifting jellyfish sink the yard beneath an imaginary ocean." },
  { id: "prehist", label: "Prehistoric", prefix: "Primeval", setting: "Animatronic dinosaurs loom over a tar-pit obstacle course of ferns and bones." },
  { id: "hero", label: "Superhero City", prefix: "Caped", setting: "A comic-book skyline of cardboard skyscrapers frames the yard in bold primary colors." },
  { id: "fairy", label: "Fairytale Kingdom", prefix: "Enchanted", setting: "A storybook castle, a beanstalk, and a fake dragon set the scene for a fairytale." },
  { id: "cyber", label: "Neon Cyberpunk", prefix: "Neon", setting: "Rain-slick chrome and holographic ad-boards flood the set in electric magenta and cyan." },
  { id: "tropic", label: "Tropical Getaway", prefix: "Castaway", setting: "Palm fronds, tiki torches, and a fake lagoon turn the yard into a desert island." },
  { id: "circus", label: "Big Top Circus", prefix: "Center-Ring", setting: "A striped big-top tent, trapeze rigs, and a ringmaster's podium take over the yard." },
  { id: "noir", label: "Film Noir", prefix: "Midnight", setting: "Everything is black-and-white shadow, venetian-blind light, and a lonely saxophone." },
  { id: "jungle", label: "Lost Jungle", prefix: "Overgrown", setting: "Vines, temple ruins, and hidden idols bury the set in a lost-world jungle." },
  { id: "arctic", label: "Polar Expedition", prefix: "Glacial", setting: "A cracked ice-shelf and a stranded expedition tent chill the entire competition." },
  { id: "royal", label: "Royal Ball", prefix: "Regal", setting: "Chandeliers, red carpet, and a throne dress the set for a palace ball." },
  { id: "toon", label: "Cartoon World", prefix: "Looney", setting: "The whole set is painted in exaggerated cartoon lines, springs, and anvils." },
  { id: "spy", label: "Secret Agent", prefix: "Covert", setting: "Laser grids, a vault door, and a briefcase turn the yard into a spy's obstacle run." },
  { id: "volcano", label: "Volcano Island", prefix: "Molten", setting: "A smoking papier-mache volcano drips fake lava across a black-rock arena." },
  { id: "carnival", label: "Boardwalk Carnival", prefix: "Midway", setting: "Ring-toss booths, a fun-house mirror maze, and a Ferris wheel light up the yard." },
  { id: "steam", label: "Steampunk Workshop", prefix: "Clockwork", setting: "Brass gears, copper pipes, and hissing steam valves crowd an inventor's workshop set." },
  { id: "disco", label: "Disco Fever", prefix: "Groovy", setting: "A mirror ball, a light-up dance floor, and a wall of speakers throw the set back to the disco era." },
  { id: "myth", label: "Mount Olympus", prefix: "Titan", setting: "Marble columns, laurel wreaths, and thunderbolt props raise the set to the home of the gods." },
];

/**
 * A seeded permutation of `0..n-1` from a string key — a small LCG Fisher-Yates. Deterministic and
 * independent of the beat rng, so choosing a theme perturbs no seeded roll.
 */
function seededOrder(key: string, n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let x = (hashSeed(key) >>> 0) || 1;
  for (let i = n - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0; // LCG step
    const j = x % (i + 1);
    const t = idx[i]!; idx[i] = idx[j]!; idx[j] = t;
  }
  return idx;
}

/**
 * The week's theme for a phase. Both phases ride ONE seeded permutation, indexed by week; each same-week
 * "beat" reads it rotated by its own seed-derived NONZERO offset `k ∈ [1, N-1]` (N = pool size):
 *  - VETO rotates by a veto offset — so the same-week HOH and veto themes ALWAYS differ (two independent
 *    permutations could collide at a shared index — the bug this replaces);
 *  - a compressed twist CYCLE (the double-eviction second cycle, which reruns a same-phase comp in the
 *    SAME week) rotates by a further cycle offset — so the second crown of a double-eviction night never
 *    reuses the first cycle's skin.
 * A nonzero rotation of a permutation is still a permutation, so no phase repeats a theme for the first N
 * weeks (24 >> a season), and a nonzero rotation can never map an index to itself, so every distinct beat
 * at the same week lands on a distinct theme. It is a pure function of (seed, phase, week, cycle) — no rng
 * draw, no persistence, restart-stable — so choosing a theme perturbs no seeded roll.
 */
export function themeForWeek(
  seed: number, phase: CompetitionPhase, week: number, cycle = 0,
): CompetitionTheme {
  const n = COMPETITION_THEMES.length;
  const order = seededOrder(`${seed}:comp-theme:hoh`, n); // one shared permutation for both phases
  const idx = (Math.max(1, week) - 1) % n;
  // Rotate the SAME permutation by nonzero, seed-derived offsets — each keeps the phase repeat-free while
  // guaranteeing a same-week beat lands on a distinct theme (idx + k mod n can never equal idx for k≠0).
  const vetoK = phase === "veto" ? 1 + ((hashSeed(`${seed}:comp-theme:veto-offset`) >>> 0) % (n - 1)) : 0;
  const cycleK = cycle > 0 ? 1 + ((hashSeed(`${seed}:comp-theme:cycle-offset`) >>> 0) % (n - 1)) : 0;
  return COMPETITION_THEMES[order[(idx + vetoK + cycleK) % n]!]!;
}

/** The themed comp NAME: the theme's adjectival prefix + the mechanic format's noun ("Haunted Trivia"). */
export function themedName(def: CompetitionDef, theme: CompetitionTheme): string {
  return `${theme.prefix} ${FORMAT_NOUN[def.format]}`;
}

/**
 * Apply a theme to a mechanic def, returning the Vault-free surfaced scaffold. The mechanic's own
 * premise (the ACTION) and beats are kept — the theme only prepends a scene-setter and renames — so the
 * result stays coherent (the theme is a skin, never a new mechanic). No stat, score, or hidden field.
 */
export function applyTheme(
  def: CompetitionDef, theme: CompetitionTheme,
): { name: string; theme: string; narrative: { premise: string; beats: string[]; winReads: string } } {
  return {
    name: themedName(def, theme),
    theme: theme.label,
    narrative: {
      premise: `${theme.setting} ${def.narrative.premise}`,
      beats: [...def.narrative.beats],
      winReads: def.narrative.winReads,
    },
  };
}
