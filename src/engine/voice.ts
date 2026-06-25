/**
 * Character VOICE & grounded MOOD (feature 0084). Two halves of "sixteen mouths, not one":
 *
 *  • VOICE — a byte-stable PUBLIC fingerprint on the static `CHARACTER` (how a houseguest TALKS:
 *    register, rhythm, energy, directness, humor, and what their voice does under stress, plus a
 *    prose signature + a light habitual lexicon). Generated once at cast time, seeded + archetype-
 *    correlated but independently varied, so two of an archetype still sound different. It is identity
 *    and NEVER drifts (owner ruling 2026-06-25) — all the turn-to-turn dynamism lives in `mood`.
 *
 *  • MOOD — a Vault-safe, observable AFFECT WORD derived live from the soul. It runs on TWO timescales:
 *    the ACUTE state (`emotionalState`, which spikes on a beat and mean-reverts within a few turns) and
 *    the MARINATED baseline (the trend of `emotionalHistory` — the set-point the ~3-month season has
 *    dragged them to). Someone ground down over weeks reads as worn even on a calm day; a long safe run
 *    reads as lasting ease. Never a number, never the hidden CAUSE — only the carriage.
 *
 * Pure + deterministic (seeded). No I/O, no Vault: voice is public, mood is an observable word.
 */
import type { RandomnessSource } from "../ports/RandomnessSource";
import type { VoiceProfile } from "../domain/voiceProfile";

export type { VoiceProfile } from "../domain/voiceProfile";

/** The option pools per dial. Order is canonical; generation picks one (archetype-biased). */
export const VOICE_DIALS = {
  register: ["formal", "polished", "plainspoken", "folksy", "crude"],
  rhythm: ["clipped", "staccato", "measured", "rambling"],
  energy: ["flat", "even", "warm", "buzzy", "manic"],
  directness: ["evasive", "diplomatic", "candid", "blunt"],
  humor: ["none", "dry", "self-deprecating", "goofy", "cutting"],
  stressTell: ["goes quiet", "gets clipped", "over-explains", "talks faster", "deflects with a joke"],
} as const;

type Dial = keyof typeof VOICE_DIALS;

/** A prose-signature pool (one is chosen per houseguest) — texture, not a bit. */
export const VOICE_SIGNATURES: readonly string[] = [
  "talks with their hands and trails off mid-thought",
  "answers a question with a question",
  "lands every point like it's the last word",
  "narrates their own feelings out loud as they happen",
  "keeps it short and lets the silence do the work",
  "circles a topic three times before landing on it",
  "undercuts anything sincere with a quick joke",
  "leans in close and drops their voice for the real talk",
  "states opinions as settled facts",
  "softens everything with a qualifier before the point",
  "thinks out loud, revising the sentence as they go",
  "delivers warmth and a read in the same breath",
];

/** A light habitual-filler pool — a houseguest gets one or two, sprinkled, never a punchline. */
export const VOICE_LEXICON_POOL: readonly string[] = [
  "honestly", "I mean", "like", "for real", "low-key", "100%", "listen", "right?",
  "okay so", "to be fair", "no but", "literally",
];

/**
 * Per-archetype dial leanings — the value an archetype TENDS toward (applied with `BIAS_STRENGTH`),
 * so a `comp-beast` skews blunt/clipped and a `social-butterfly` warm/rambling, WITHOUT collapsing
 * the cast onto one voice (every other dial is still free, and the lean itself only sometimes wins).
 * Keyed by archetype string to keep this a leaf module (no import cycle with characterFactory).
 */
export const VOICE_ARCHETYPE_BIAS: Record<string, Partial<Record<Dial, string>>> = {
  "comp-beast": { directness: "blunt", rhythm: "clipped", energy: "buzzy", stressTell: "gets clipped" },
  "mastermind": { directness: "diplomatic", register: "polished", humor: "dry", stressTell: "goes quiet" },
  "social-butterfly": { energy: "warm", rhythm: "rambling", humor: "goofy", directness: "candid" },
  "floater": { directness: "evasive", energy: "even", stressTell: "deflects with a joke" },
  "villain": { directness: "blunt", humor: "cutting", register: "polished", stressTell: "talks faster" },
  "underdog": { humor: "self-deprecating", energy: "warm", stressTell: "over-explains" },
  "flirt": { energy: "warm", humor: "goofy", directness: "candid", rhythm: "rambling" },
  "loyalist": { directness: "candid", energy: "warm", stressTell: "over-explains" },
};

const BIAS_STRENGTH = 0.55; // chance the archetype's lean wins a biased dial (else a free pick)

function pick<T>(rng: RandomnessSource, options: readonly T[]): T {
  return options[rng.int(options.length)]!;
}

/** Pick a dial value: with `BIAS_STRENGTH` take the archetype's lean (if any), else a free pick. */
function pickDial(rng: RandomnessSource, dial: Dial, lean?: string): string {
  const roll = rng.next(); // ALWAYS draw, so the per-NPC draw count is stable with or without a lean
  if (lean !== undefined && roll < BIAS_STRENGTH) return lean;
  return pick(rng, VOICE_DIALS[dial]);
}

/**
 * Generate a houseguest's voice fingerprint — seeded + archetype-biased, independently varied. The
 * draw count is FIXED (one roll per dial + signature + two lexicon picks) regardless of archetype, so
 * a caller's seeded stream advances identically for every houseguest.
 */
export function generateVoice(rng: RandomnessSource, archetype: string): VoiceProfile {
  const lean = VOICE_ARCHETYPE_BIAS[archetype] ?? {};
  const register = pickDial(rng, "register", lean.register);
  const rhythm = pickDial(rng, "rhythm", lean.rhythm);
  const energy = pickDial(rng, "energy", lean.energy);
  const directness = pickDial(rng, "directness", lean.directness);
  const humor = pickDial(rng, "humor", lean.humor);
  const stressTell = pickDial(rng, "stressTell", lean.stressTell);
  const signature = pick(rng, VOICE_SIGNATURES);
  // One or two habitual fillers (distinct).
  const a = pick(rng, VOICE_LEXICON_POOL);
  const b = pick(rng, VOICE_LEXICON_POOL);
  const lexicon = a === b ? [a] : [a, b];
  return { register, rhythm, energy, directness, humor, stressTell, signature, lexicon };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5);

/** The lasting carriage from a soul set-point (0..1) — the marinated baseline's word. */
function carriageWord(v: number): string {
  if (v < 0.18) return "hollowed out";
  if (v < 0.33) return "worn down";
  if (v < 0.45) return "subdued";
  if (v < 0.55) return "even";
  if (v < 0.68) return "settled";
  if (v < 0.83) return "at ease";
  return "riding high";
}

/** Strong-deviation thresholds: only a real spike/crash overrides the marinated carriage. */
const ACUTE_OVERRIDE = 0.35;
const ACUTE_DISTRESS = 0.25; // an acute crisis always shows, regardless of the baseline
const VOLATILE = 0.7;

/**
 * The Vault-safe MOOD word for the voicer. Combines the MARINATED baseline (the trend of
 * `emotionalHistory` — what the season has done to them) with the ACUTE state (`emotionalState`),
 * plus a volatility qualifier. The marinated carriage is the default; the acute state only overrides
 * it on a strong spike or crash — so a worn-down houseguest still reads worn on a calm day, while a
 * fresh crisis still surfaces. Never a number, never the cause. `emotionalHistory` defaults to the
 * acute value (a fresh soul has no arc yet).
 */
export function moodWord(emotionalState: number, volatility: number, emotionalHistory: readonly number[] = []): string {
  const acute = clamp01(emotionalState);
  const marinated = emotionalHistory.length ? clamp01(mean(emotionalHistory)) : acute;
  const dev = acute - marinated;

  let word = carriageWord(marinated);
  if (acute < ACUTE_DISTRESS) word = `shaken, ${word}`;
  else if (dev <= -ACUTE_OVERRIDE) word = `rattled, ${word}`;
  else if (dev >= ACUTE_OVERRIDE) word = `buoyed, ${word}`;

  if (clamp01(volatility) > VOLATILE) word = `${word}, on edge`;
  return word;
}
