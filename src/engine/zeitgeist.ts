import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed } from "./characterFactory";

/**
 * The move-in zeitgeist snapshot (feature 0062): the ONE frozen, shared picture of the real-world
 * pop-culture moment the whole cast moved in with — trending screen/music/sports/news/internet plus a
 * one-line read of the mood. Captured ONCE at season creation, frozen byte-stable, recalled all season,
 * and woven into BOTH the player's moment prompts AND the off-screen society/gossip prompts so the house
 * shares one consistent real world that grows more dated as sequestration drags on (§7).
 *
 * THE HARD LINE (§6): this is a THIRD state category — public, shared, real-world FLAVOR. It is NOT
 * Vault-secret (the player lives in the same world, so it is not hidden) and it is NOT game truth (it
 * NEVER informs, decides, or perturbs a single competition result, vote, nomination, or soul fold —
 * anti-sycophancy holds verbatim). It is something the narrator VOICES, never something the engine
 * COMPUTES against. Pure and Vault-free by construction: no name, stat, hidden attribute, or secret is
 * baked in; the slices are evocative CATEGORY descriptors the model fleshes out in a houseguest's own
 * voice ("facts to voice, never scripts to recite"), upgraded by C32's live `web_search` for the long
 * tail. Nothing here ever reaches the deterministic core.
 *
 * SEEDED + FROZEN (§3/§9): the deterministic build below is seeded off the SAME season-seed hinge as the
 * cast, so a snapshot is reproducible-by-seed and stays byte-identical across every turn, restart, and
 * recall (the no-internet fiction IS the freeze). A live web search (FE-owned, like the 0051 image
 * provider) may REPLACE it once at creation with `source: "web_search"`; tests and seeded replays use
 * this deterministic `model-framed` fallback (mirroring the deterministic-embedding fake, ADR 0004).
 */

/** The slices of the frozen zeitgeist — a shared baseline refracted per-NPC at read time (§4). */
export type ZeitgeistSlice = "screen" | "music" | "sports" | "news" | "internet";

/** The ordered slice list (stable: drives the seeded draws + the prompt rendering order). */
export const ZEITGEIST_SLICES: readonly ZeitgeistSlice[] = ["screen", "music", "sports", "news", "internet"];

/** How the snapshot was seeded — the fail-soft tier (§8). `absent` carries no slices (round-trips as absent). */
export type ZeitgeistSource = "web_search" | "model-framed" | "absent";

export interface WorldSnapshot {
  /** The in-fiction move-in date the house is frozen at (the world the cast moved in WITH). */
  capturedFor: string;
  /** The real timestamp the snapshot was taken — PROVENANCE, operational metadata, NEVER voiced. */
  capturedAt: string;
  /** The real-world lag applied at capture (§11 #1, default ~7) — the cast starts slightly behind. */
  lagDays: number;
  /** How it was seeded (the fail-soft tier). */
  source: ZeitgeistSource;
  /** A handful of evocative items per slice (texture, not an almanac — §3) + a one-line mood read. */
  slices: {
    screen: string[];
    music: string[];
    sports: string[];
    news: string[];
    internet: string[];
    /** One line reading the cultural moment at move-in. */
    mood: string;
  };
}

/**
 * Capture-budget constants (§11 #3) — small-and-bounded: enough for consistent color, never a knowledge
 * base. The single tunable home (the B59 pattern). The default lag is a ONE-TIME offset (§11 #1): the
 * cast starts slightly behind and the snapshot never updates (the rolling-window alternative would break
 * sequestration — the house would mysteriously learn things that happened after move-in).
 */
export const ZEITGEIST = {
  /** Items drawn per non-mood slice (bounds the prompt budget). */
  itemsPerSlice: 2,
  /** The default real-world lag at capture, in days (the one-time offset). */
  defaultLagDays: 7,
} as const;

/**
 * The curated raw material per slice — evocative CATEGORY descriptors, deliberately free of dated real
 * proper nouns (no fixed celebrity/film/result that would harden into a stale "game fact" or drift across
 * the cast). The model dresses these in a houseguest's own voice; C32's live search fills the long tail.
 * No names, no outcomes, no hidden state — pure public flavor (the HOUSE_EVENT_POOL pattern).
 */
const POOLS: Record<ZeitgeistSlice, readonly string[]> = {
  screen: [
    "a big-swing blockbuster the whole internet was arguing about",
    "a prestige streaming series everyone binged and spoiled for each other",
    "a surprise indie darling critics would not shut up about",
    "a long-awaited franchise sequel that split the fandom down the middle",
    "a reality-competition season that became appointment viewing",
    "an awards-season frontrunner people kept calling overrated",
  ],
  music: [
    "a pop megastar's stadium tour that sold out in minutes",
    "an inescapable summer song nobody could get out of their head",
    "a surprise album drop that broke streaming records overnight",
    "a genre-bending collaboration everyone had an opinion about",
    "a viral dance track tied to a clip on every feed",
    "a beloved act's comeback single after years away",
  ],
  sports: [
    "a championship run in its tense final stretch",
    "a bracket-busting upset that wrecked everyone's office pool",
    "a superstar chasing a record the whole season",
    "a bitter cross-town rivalry coming to a head",
    "an underdog team's improbable Cinderella story",
    "a blockbuster trade that lit up every group chat",
  ],
  news: [
    "a wave of new gadgets and AI chatter dominating the feeds",
    "a stretch of wild, swingy weather making the headlines",
    "a buzzy product launch with lines around the block",
    "a feel-good viral rescue story everyone shared",
    "an economy-and-prices conversation nobody could escape",
    "a space-and-science milestone that briefly united the timeline",
  ],
  internet: [
    "a meme phrase that crept into everyone's vocabulary",
    "a viral moment that got remixed into a thousand videos",
    "an oddly-specific trend that took over every feed for a week",
    "a chronically-online discourse that flared up and burned out fast",
    "a wholesome clip that briefly made the internet agree on something",
    "a catchphrase from a clip nobody could stop quoting",
  ],
};

/** The mood-line raw material — a one-line read of the cultural moment at move-in. */
const MOOD_POOL: readonly string[] = [
  "a restless, online, everyone-has-a-take kind of moment",
  "a hopeful, get-back-out-there energy in the air",
  "a slightly-exhausted, doom-scrolling-but-laughing-through-it mood",
  "a giddy, summer-is-here, nothing-can-touch-us feeling",
  "a tense, glued-to-the-headlines, hold-your-breath stretch",
  "a nostalgic, everything-old-is-new-again wave",
];

/** A seeded sample of `n` distinct items from a pool (order-stable; never exceeds the pool). */
function sample(pool: readonly string[], n: number, rng: RandomnessSource): string[] {
  const idx = pool.map((_, i) => i);
  // Partial Fisher–Yates over the index list (deterministic under the seeded rng).
  for (let i = 0; i < Math.min(n, idx.length); i++) {
    const j = i + rng.int(idx.length - i);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, Math.min(n, pool.length)).map((i) => pool[i]!);
}

export interface BuildWorldSnapshotOpts {
  /** The season seed hinge (shared with the cast) — same seed ⇒ byte-identical snapshot. */
  seed: number;
  /** The in-fiction move-in date the house freezes at. */
  capturedFor: string;
  /** Provenance: when it was taken (defaults to a fixed sentinel so the deterministic build stays byte-stable). */
  capturedAt?: string;
  /** The one-time lag offset (§11 #1); defaults to ZEITGEIST.defaultLagDays. */
  lagDays?: number;
  /** The fail-soft tier (§8): defaults to `model-framed` (the deterministic, no-live-search build). */
  source?: ZeitgeistSource;
}

/**
 * Build the frozen, seeded snapshot (§3) — the deterministic `model-framed` fallback the tests and seeded
 * replays use, and the no-provider path (§8). Forked off a DEDICATED sub-stream of the season seed (the
 * RNG-isolation lesson, #338) so it never perturbs the shared cast/competition stream — the §6/§10
 * outcome-invariance guard holds by construction. `source: "absent"` yields an empty snapshot (the §8
 * skip tier; it round-trips as absent and changes no outcome trivially).
 */
export function buildWorldSnapshot(opts: BuildWorldSnapshotOpts): WorldSnapshot {
  const lagDays = opts.lagDays ?? ZEITGEIST.defaultLagDays;
  const source = opts.source ?? "model-framed";
  const capturedAt = opts.capturedAt ?? "(captured at move-in)";
  if (source === "absent") {
    return {
      capturedFor: opts.capturedFor, capturedAt, lagDays, source,
      slices: { screen: [], music: [], sports: [], news: [], internet: [], mood: "" },
    };
  }
  // A dedicated, isolated sub-stream — NEVER the shared house/competition stream (#338).
  const rng = new SeededRandom(hashSeed(`${opts.seed}:zeitgeist`));
  const draw = (slice: ZeitgeistSlice): string[] => sample(POOLS[slice], ZEITGEIST.itemsPerSlice, rng);
  return {
    capturedFor: opts.capturedFor, capturedAt, lagDays, source,
    slices: {
      screen: draw("screen"),
      music: draw("music"),
      sports: draw("sports"),
      news: draw("news"),
      internet: draw("internet"),
      mood: MOOD_POOL[rng.int(MOOD_POOL.length)]!,
    },
  };
}

/** True when the snapshot carries voiceable content (present + not the `absent` skip tier). */
export function hasZeitgeist(snap: WorldSnapshot | null | undefined): snap is WorldSnapshot {
  return !!snap && snap.source !== "absent"
    && (snap.slices.mood.length > 0 || ZEITGEIST_SLICES.some((s) => snap.slices[s].length > 0));
}

/**
 * The per-NPC slice EMPHASIS (§4) — a READ-TIME projection from the houseguest's PUBLIC persona facets
 * (archetype / background / vocation / demeanor; the same facets the narrator already voices), never
 * stored per-NPC state. Returns the slices this person leans into, most-fluent first, so the cast draws
 * on the SAME shared snapshot through DIFFERENT lenses (a sports fan riffs on the championship; the
 * chronically-online one drops the meme). A VOICE ANCHOR, never a number, never a lever — and it reads
 * ONLY public text, so it touches no hidden state.
 */
export function sliceEmphasisFor(persona: {
  archetype?: string; strategyStyle?: string; background?: string;
  vocation?: string; hometown?: string; demeanor?: string; biography?: string;
}): ZeitgeistSlice[] {
  const hay = [
    persona.archetype, persona.strategyStyle, persona.background,
    persona.vocation, persona.hometown, persona.demeanor, persona.biography,
  ].filter(Boolean).join(" ").toLowerCase();
  // Keyword leanings → a per-slice weight; ties break on the stable ZEITGEIST_SLICES order, and a
  // deterministic per-persona tiebreak (hashed off the text) keeps two DIFFERENT personas from
  // collapsing onto the identical default ordering (so the §4 "different emphases" guard holds).
  const has = (...kw: string[]): number => kw.reduce((a, k) => a + (hay.includes(k) ? 1 : 0), 0);
  const weight: Record<ZeitgeistSlice, number> = {
    screen: has("film", "actor", "artist", "creative", "drama", "theater", "comedian", "host", "tv", "entertain", "performer", "influencer"),
    music: has("music", "dj", "sing", "dancer", "band", "festival", "party", "social", "vibe"),
    sports: has("athlete", "coach", "fitness", "trainer", "comp", "competitor", "sport", "physical", "gym", "team", "beast"),
    news: has("teacher", "lawyer", "nurse", "engineer", "scientist", "analyst", "journalist", "policy", "news", "tech", "smart", "mental", "strategist", "professor"),
    internet: has("online", "stream", "content", "meme", "gamer", "creator", "viral", "chronically", "internet", "tiktok", "youtube"),
  };
  const tie = hashSeed(hay);
  return [...ZEITGEIST_SLICES].sort((a, b) => {
    if (weight[b] !== weight[a]) return weight[b] - weight[a];
    // Stable, persona-specific tiebreak so distinct personas don't all default-order identically.
    const ra = (hashSeed(`${tie}:${a}`) % 1000), rb = (hashSeed(`${tie}:${b}`) % 1000);
    if (ra !== rb) return ra - rb;
    return ZEITGEIST_SLICES.indexOf(a) - ZEITGEIST_SLICES.indexOf(b);
  });
}

const SLICE_LABEL: Record<ZeitgeistSlice, string> = {
  screen: "Screen (film / TV / streaming)",
  music: "Music",
  sports: "Sports",
  news: "News & culture",
  internet: "The internet (memes / viral moments)",
};

export interface RenderZeitgeistOpts {
  /** The current HOH week (≥1). The longer since move-in (week 1), the more dated the house sounds (§7). */
  week?: number;
  /**
   * Which reach channel this block colors (§5): `player` (the player's on-screen moment prompt) or
   * `offscreen` (an NPC-to-NPC society/gossip scene — the C32-beyond delta). Only the framing differs;
   * both read the SAME frozen snapshot, so references never contradict across channels.
   */
  channel?: "player" | "offscreen";
  /**
   * The houseguest whose PUBLIC persona refracts the snapshot (§4) — when present, the block leads with
   * THIS person's slice emphasis so they don't recite an identical list. Read-time, public-facets-only.
   */
  persona?: Parameters<typeof sliceEmphasisFor>[0];
}

/**
 * Render the Vault-free "the world you all moved in with" prompt block (§5/§7) — the FACTS the narrator
 * voices, the freeze, the elapsed in-house duration, and the out-of-the-loop instruction that scales with
 * the weeks. Reads ONLY the public snapshot (provenance fields like `capturedAt` are NEVER emitted). The
 * caller composes this into the moment / off-screen prompt; an absent snapshot renders nothing (§8 — the
 * game degrades to C32's per-reference behavior, unchanged).
 */
export function renderZeitgeist(snap: WorldSnapshot | null | undefined, opts: RenderZeitgeistOpts = {}): string {
  if (!hasZeitgeist(snap)) return "";
  const week = Math.max(1, Math.floor(opts.week ?? 1));
  const channel = opts.channel ?? "player";
  // Reuse the existing week counter — no new clock (§7). Week 1 = move-in; each later week is "more dated".
  const weeksIn = week - 1;
  const elapsed = weeksIn <= 0
    ? "you all moved in just now — these references are fresh"
    : weeksIn === 1
      ? "you have been sealed in for about a week now"
      : `you have been sealed in for about ${weeksIn} weeks now`;

  const emphasis = opts.persona ? sliceEmphasisFor(opts.persona) : [...ZEITGEIST_SLICES];
  const lead = emphasis.filter((s) => snap.slices[s].length > 0);
  const lines: string[] = [
    "THE WORLD YOU ALL MOVED IN WITH (shared, frozen real-world flavor — voice it in character, never as a",
    `  dashboard; FLAVOR ONLY — it never decides or informs ANY game fact, outcome, or decision). The house`,
    `  is FROZEN as of move-in (${snap.slices.mood ? snap.slices.mood + "; " : ""}${elapsed}). The cast shares the SAME real world up to that`,
    "  day and has had NO contact since — so everyone here can reference these, but ANYTHING that happened",
    "  AFTER move-in is UNKNOWABLE to the whole house: a guess, gotten wrong, or waved off (\"no idea, we've",
    "  been locked in here\"). The longer the season runs, the more dated the references and the more the",
    "  house leans into being behind — that out-of-the-loop wrongness is CORRECT, it is the played texture.",
  ];
  for (const slice of lead) {
    lines.push(`  · ${SLICE_LABEL[slice]}: ${snap.slices[slice].join("; ")}.`);
  }
  if (opts.persona && lead.length > 0) {
    lines.push(
      `  This houseguest leans into ${lead.slice(0, 2).map((s) => s).join(" + ")} — refract the SHARED world`,
      "  through who THEY are (their own fluency), so the cast doesn't recite an identical list.",
    );
  }
  if (channel === "offscreen") {
    lines.push(
      "  This colors OFF-SCREEN life too: houseguests bond over a show they both loved, gossip drifts onto",
      "  a celebrity, someone makes a dated joke mid-scheme — the same shared world, never the player's only.",
    );
  }
  return lines.join("\n");
}
