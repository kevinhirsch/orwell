import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { ARCHETYPES, DEMEANORS, hashSeed } from "./characterFactory";
import { GIVEN_NAMES } from "./data/givenNames";

/**
 * The PRODUCER persona (the casting-interview voice).
 *
 * The producer is a REAL generated character — as deep a persona as any houseguest, built by the
 * same `CharacterFactory` machinery (archetypes / demeanors / the real-name corpus) — BUT it is
 * explicitly NOT a houseguest:
 *   · OFF-CAMERA — the unseen producer voice across the casting table. It has NO headshot/portrait
 *     and never appears in "The Cast", the roster, the portrait pipeline, or whereabouts.
 *   · NOT one of the 16 — it is never in `GameHouse.npcs`, never seeded into relationships, never
 *     in the house, never witnessed by anyone in the game.
 *
 * It is a persistent, SEEDED (reproducible) persona with a distinct personality/voice that the
 * casting interview voices CONSISTENTLY (the same seed → the same producer, across turns and a
 * restart). Everything here is PUBLIC voice material (facts to voice, ADR 0003) — the producer is
 * a GM-voice entity, not a houseguest with secret game state, so nothing here is Vault content.
 *
 * The flags below are structural assertions the exclusion tests read: a producer is, by
 * construction, off-camera, portrait-less, and not a houseguest.
 */
export interface Producer {
  /** A real first name (seeded from the same corpus as the cast) — the byline on the casting table. */
  name: string;
  /** The producer's CORE temperament archetype (reused from the cast archetype vocabulary). */
  archetype: string;
  /** Their observable register / voice (reused from the cast demeanor pool) — how they come across. */
  demeanor: string;
  /** Their strategic read on running a casting room — the lens they probe a player through. */
  disposition: string;
  /** Their calculated, strategic WIT style — the kind of dry humor they deploy to disarm/test. */
  wit: string;
  /** A small, distinct quirk that colors their voice consistently all interview. */
  quirk: string;
  /** A one-line backstory: who this producer is and how many seasons they have cast. */
  backstory: string;
  /** STRUCTURAL: the producer is off-camera (the unseen voice) — never on a portrait or in a room. */
  offCamera: true;
  /** STRUCTURAL: the producer has NO headshot — excluded from the portrait pipeline. */
  headshot: false;
  /** STRUCTURAL: the producer is NOT one of the 16 — never in the cast / roster / whereabouts. */
  houseguest: false;
}

// --- The producer's persona vocabularies (seeded draws) -----------------------
// Distinct from a houseguest's: a producer is a VETERAN of casting rooms, not a player. Each pool is
// PUBLIC voice flavor only (no stats, no hidden game state) and carries no Vault vocabulary. Every
// entry is a plain phrase that does NOT contain the stat-key substrings "physical"/"mental"/"social"
// (so it can never serialize into a leak the Vault sentinel sweeps hunt for).

/** How the producer reads a casting room — the strategic lens they run the interview through. */
const PRODUCER_DISPOSITIONS: readonly string[] = [
  "a veteran who has cast a dozen seasons and can smell a fake answer from across the table",
  "a former editor who casts for the story, not the résumé — they want the contradiction, not the highlight reel",
  "a sharp talent scout who plays the long game, banking the tell now to use it on air later",
  "an ice-cool casting director who lets a silence sit until the rehearsed answer cracks",
  "a producer who has seen every archetype walk in and is hunting for the one thing they didn't expect",
  "a quietly ruthless gatekeeper who decides in the first five minutes and spends the rest testing the read",
];

/** The producer's CALCULATED wit — deliberate, strategic humor used to disarm and provoke honesty. */
const PRODUCER_WITS: readonly string[] = [
  "a dry, deadpan aside that lands right before a hard question, to knock them off balance",
  "a wry, knowing needle that disarms the rehearsed answer and dares them to be real",
  "a sly, well-timed bit of gallows humor about how the house chews people up",
  "a flat, faux-innocent question with a hook in it — funny until they realize it was a test",
  "a cool sardonic clip that flatters and traps in the same breath",
  "a low-key teasing jab that makes the player relax just enough to overshare",
];

/** A small distinct quirk that keeps the voice consistent (a verbal habit / tic, never stage directions). */
const PRODUCER_QUIRKS: readonly string[] = [
  "circles back to a thing they said three answers ago, to see if the story holds",
  "repeats the player's own loaded word back to them as a single-word question",
  "frames the dangerous questions as throwaways and the throwaways as if they matter",
  "keeps a running tally out loud of the contradictions, lightly, never unkindly",
  "answers a non-answer with a longer silence than is comfortable",
  "occasionally lets one genuinely warm beat slip, then snaps the frame back to business",
];

/** The producer's years-in-the-room backstory line — who they are and how seasoned. */
const PRODUCER_BACKSTORIES: readonly string[] = [
  "ran the casting desk for years before this and has watched a hundred would-be winners flame out",
  "came up in the edit bay and crossed over to casting because they wanted the story at the source",
  "has cast every kind of player and is bored by the ones who already think they've won",
  "is the producer who fought to put the wild card on the wall and was usually right",
  "treats the casting room like a chess opening — every question is two moves ahead of the answer",
];

/**
 * Generate the producer persona (feature: producer persona). Reuses the `CharacterFactory` archetype
 * + demeanor vocabularies and the real-name corpus so the producer is a CHARACTER built by the same
 * machinery as the cast — but a producer-flavored one (a veteran caster, not a contestant).
 *
 * SEEDED & reproducible: the same `rng` always yields the same producer. Player-INDEPENDENT (it reads
 * only its rng, never a player field), so a given season seed voices the same producer regardless of
 * who the player turns out to be. Vault-free by construction (every field is public voice flavor).
 */
export function generateProducer(rng: RandomnessSource): Producer {
  return {
    name: rng.pick(GIVEN_NAMES),
    archetype: rng.pick(ARCHETYPES).archetype,
    demeanor: rng.pick(DEMEANORS),
    disposition: rng.pick(PRODUCER_DISPOSITIONS),
    wit: rng.pick(PRODUCER_WITS),
    quirk: rng.pick(PRODUCER_QUIRKS),
    backstory: rng.pick(PRODUCER_BACKSTORIES),
    offCamera: true,
    headshot: false,
    houseguest: false,
  };
}

/**
 * Generate the producer for a season, keyed off the season seed (or any stable pre-game seed). Forked
 * onto a DEDICATED sub-stream (hashed off the seed) so generating the producer never perturbs the
 * house/competition streams — exactly the RNG-isolation precedent the factory uses for hidden elements
 * and backstory facets. Same seed in → same producer out (reproducible across turns and a restart).
 */
export function producerForSeed(seed: number): Producer {
  return generateProducer(new SeededRandom(hashSeed(`${seed}:producer`)));
}

/**
 * The producer's PERSONA block woven into the casting prompt (facts to voice, ADR 0003) — guidance the
 * model voices the producer AS, never a script to recite. Public voice flavor only; carries no secret.
 */
export function renderProducerVoice(producer: Producer): string {
  return [
    "WHO YOU ARE (the producer running this interview — voice THIS persona consistently, it is the same",
    "producer every turn; these are facts to voice, never lines to read):",
    `  - Name: ${producer.name} — the casting producer across the table (off-camera; you never appear in the house).`,
    `  - Core temperament: ${producer.archetype}; you come across as ${producer.demeanor}.`,
    `  - How you read the room: ${producer.disposition}.`,
    `  - Your wit (calculated, never random): ${producer.wit}. You use humor DELIBERATELY — to disarm, to`,
    "    provoke a more honest answer, to test a read, to keep them off balance — never as a comedy bit and",
    "    never to flatter.",
    `  - A tell of your own: you ${producer.quirk}.`,
    `  - Your track record: you ${producer.backstory}.`,
  ].join("\n");
}
