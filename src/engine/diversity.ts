import type { EntityId } from "../domain/ids";
import type { RandomnessSource } from "../ports/RandomnessSource";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed } from "./characterFactory";
import type { Houseguest } from "./characterFactory";
import { nameGenderOf } from "./data/nameGender";
import type { NameGender } from "./data/nameGender";
import {
  MIN_BIPOC, MIN_QUEER, MIN_PER_BINARY_GENDER, MIN_PER_AGE_BAND, MAX_PER_AGE_BAND,
  AGE_BANDS, AGE_ELIGIBILITY_FLOOR, ageBandOf,
  BIPOC_ETHNICITIES, NON_BIPOC_ETHNICITIES, ALL_ETHNICITIES, MAX_PER_ETHNICITY,
  GENDER_PRESENTATIONS, MAX_NONBINARY,
  ORIENTATIONS, QUEER_ORIENTATIONS, PUBLICLY_OUT_PROB,
} from "./diversityConstants";
import type { EthnicityIdentity, GenderPresentation, Orientation } from "./diversityConstants";

/**
 * Feature 0063 — the casting diversity floor: engine-guaranteed FLOORS (BIPOC ≥ MIN_BIPOC, LGBTQ+ ≥
 * MIN_QUEER, gender roughly balanced, ages spread across bands), an ethnicity-grounded identity facet,
 * and a character-driven sexual-orientation model split across the Vault Wall by DISCLOSURE.
 *
 * RNG ISOLATION (the #338 lesson — CRITICAL): EVERY diversity-attribute draw (ethnicity / gender /
 * orientation / disclosure) runs on a DEDICATED, isolated seeded sub-stream forked off the cast seed via
 * `hashSeed`, NEVER the shared house/competition/vote stream. These attributes are DESCRIPTIVE ONLY —
 * they never feed a competition, a vote, or any outcome — so the public competition/vote sequence is
 * byte-for-byte unchanged with or without them. (Verified by the juryReach gate + a golden test.)
 *
 * VALIDATE / REPAIR (the L28 caps' symmetric operation): the layer is DEALT off the sub-stream, then a
 * post-pass CHECKS each floor and REPAIRS the minimum number of picks to satisfy it (swap the next
 * legal-ish draw, never spin — the same guard-budget discipline `spreadFacet` uses). Deterministic per
 * seed and player-INDEPENDENT (the sub-stream keys off the cast's seeded NAMES, never the player).
 *
 * THE VAULT SPLIT: the layer returns PUBLIC facets (ethnicity, gender presentation, an out orientation)
 * that fold onto the byte-stable public Character, AND a HIDDEN `privateOrientations` map (closeted /
 * not-yet-out houseguests) that the caller seals into the Vault — it NEVER appears on any player or
 * admin projection until a 0002 pathway surfaces it.
 */

/** The PUBLIC, Vault-free diversity facets that fold onto a houseguest's byte-stable Character. */
export interface PublicDiversityFacets {
  /** The heritage / cultural-identity label — a lived facet of a full character (§3.2). */
  ethnicity: string;
  /** Whether this houseguest counts toward the BIPOC floor (engine-internal; not a projected stat). */
  bipoc: boolean;
  /** The grounded complexion cue 0058's physicalCharacteristics.skinTone reads (so text+portrait agree). */
  skinTone: string;
  /** How the houseguest presents — descriptive PUBLIC facet, never a competition input (§3.3). */
  genderPresentation: GenderPresentation;
  /**
   * The (possibly age-spread-REPAIRED) age — descriptive only (age is NOT a competition/vote input), so
   * the caller writes it back onto the public Character to satisfy the age-band floor. Equal to the
   * drawn age when no repair was needed. The ageLook (0058) then reads this so text+portrait agree.
   */
  age: number;
  /** True when the gender presentation coheres with the NAME (name is unisex, or matches name-gender). */
  nameCoheres: boolean;
  /** A PUBLICLY-OUT orientation (the house knows it) — a public facet; ABSENT when held privately. */
  outOrientation?: Orientation;
}

/** The per-houseguest layer: public facets + (when private) the Vault-sealed orientation. */
export interface DiversityLayer {
  /** Public facets per NPC id — fold onto the byte-stable Character. */
  public: Record<EntityId, PublicDiversityFacets>;
  /**
   * The HIDDEN, Vault-sealed orientation per NPC id — present ONLY for houseguests who hold their
   * orientation privately (closeted / not-yet-out). The caller seals these; they NEVER project. Out
   * houseguests are absent here (their orientation is the public `outOrientation`).
   */
  privateOrientations: Record<EntityId, Orientation>;
}

/** Internal working record (one per NPC) — assembled, then validated/repaired, then split. */
interface Draft {
  id: EntityId;
  name: string;
  nameGender: NameGender;
  age: number;
  ethnicity: EthnicityIdentity;
  genderPresentation: GenderPresentation;
  orientation: Orientation;
  /** True when the orientation is public (out); false when held privately (Vault-sealed). */
  out: boolean;
  /** True when the balance repair had to flip a clearly-gendered name (a bounded, documented exception). */
  coherenceFlipped?: boolean;
}

const orientationSpec = (o: Orientation) => ORIENTATIONS.find((s) => s.orientation === o)!;
const isQueer = (o: Orientation): boolean => orientationSpec(o).queer;

/** Counts toward the LGBTQ+ floor: a non-straight orientation OR a nonbinary presentation (owner #4). */
function countsQueer(d: Pick<Draft, "orientation" | "genderPresentation">): boolean {
  return isQueer(d.orientation) || d.genderPresentation === "nonbinary";
}

/** A capped draw from `pool` honoring a per-key max; relaxes rather than spinning (the L28 discipline). */
function pickCapped<T>(rng: RandomnessSource, pool: readonly T[], keyOf: (t: T) => string, uses: Map<string, number>, maxEach: number): T {
  for (let g = 0; g < 400; g++) {
    const v = pool[rng.int(pool.length)]!;
    const k = keyOf(v);
    if ((uses.get(k) ?? 0) < maxEach) { uses.set(k, (uses.get(k) ?? 0) + 1); return v; }
  }
  const v = pool[rng.int(pool.length)]!;
  uses.set(keyOf(v), (uses.get(keyOf(v)) ?? 0) + 1);
  return v;
}

/**
 * Generate + validate/repair the diversity layer for the whole cast off a DEDICATED isolated sub-stream.
 * `seed` is the cast seed; the sub-streams fork off it via `hashSeed` (never the shared house stream).
 * The houseguests supply their seed-stable NAME (for gender coherence) and AGE (for the age-band floor);
 * NO competition-relevant draw happens here, so the season's outcome sequence is unchanged.
 */
export function generateDiversityLayer(seed: number, npcs: readonly Houseguest[]): DiversityLayer {
  // Dedicated, isolated sub-streams — each forked off the cast seed, NEVER the shared house stream.
  const ethRng = new SeededRandom(hashSeed(`${seed}:diversity:ethnicity`));
  const genRng = new SeededRandom(hashSeed(`${seed}:diversity:gender`));
  const orRng = new SeededRandom(hashSeed(`${seed}:diversity:orientation`));
  const discRng = new SeededRandom(hashSeed(`${seed}:diversity:disclosure`));

  // ── 1. Initial deal (capped spreads, off the sub-streams) ────────────────────────────────────────
  const ethUses = new Map<string, number>();
  const drafts: Draft[] = npcs.map((n) => {
    const nameGender = nameGenderOf(n.name);
    // Gender presentation defaults to the name's typical gender; unisex names get a seeded pick (man/
    // woman here — nonbinary is assigned later, only among unisex names, capped). Keeps name+presentation
    // coherent: a clearly-gendered name always presents that way at the deal.
    const genderPresentation: GenderPresentation =
      nameGender === "man" ? "man"
      : nameGender === "woman" ? "woman"
      : genRng.next() < 0.5 ? "man" : "woman";
    // Ethnicity dealt off the whole pool, capped — BIPOC is repaired UP below if the deal falls short.
    const ethnicity = pickCapped(ethRng, ALL_ETHNICITIES, (e) => e.heritage, ethUses, MAX_PER_ETHNICITY);
    const orientation = ORIENTATIONS[orRng.int(ORIENTATIONS.length)]!.orientation;
    return { id: n.id, name: n.name, nameGender, age: n.character.age, ethnicity, genderPresentation, orientation, out: true };
  });

  // ── 2. Repair — BIPOC floor (swap non-BIPOC drafts up to BIPOC heritages, respecting the cap) ────
  const bipocCount = () => drafts.filter((d) => d.ethnicity.bipoc).length;
  if (bipocCount() < MIN_BIPOC) {
    const bipocUses = new Map<string, number>();
    for (const d of drafts) if (d.ethnicity.bipoc) bipocUses.set(d.ethnicity.heritage, (bipocUses.get(d.ethnicity.heritage) ?? 0) + 1);
    for (const d of drafts) {
      if (bipocCount() >= MIN_BIPOC) break;
      if (d.ethnicity.bipoc) continue;
      d.ethnicity = pickCapped(ethRng, BIPOC_ETHNICITIES, (e) => e.heritage, bipocUses, MAX_PER_ETHNICITY);
    }
  }

  // ── 3. Repair — gender balance (bring each binary up to its floor) ───────────────────────────────
  // Coherence-first: flip UNISEX-named drafts (a "Jordan" presents either way) before anything else.
  // Only if the seeded NAME draw skewed so hard that unisex flips can't reach the floor does it fall back
  // to flipping a draft from the OVER-represented side — marking it `coherenceFlipped` so the test treats
  // it as a documented, bounded exception (names are byte-stable on the calibration stream, so an extreme
  // single-gender name draw is genuinely possible; the floor is the owner's locked guarantee).
  const countGender = (g: GenderPresentation) => drafts.filter((d) => d.genderPresentation === g).length;
  for (const target of ["man", "woman"] as const) {
    const other: GenderPresentation = target === "man" ? "woman" : "man";
    let guard = 0;
    while (countGender(target) < MIN_PER_BINARY_GENDER && guard++ < 100) {
      // (a) a unisex-named draft on the other binary, then (b) a unisex draft currently nonbinary…
      let flip = drafts.find((d) => d.nameGender === "unisex" && d.genderPresentation === other)
        ?? drafts.find((d) => d.nameGender === "unisex" && d.genderPresentation === "nonbinary");
      // (c) last resort: a clearly-gendered draft from the SURPLUS side (only while it stays in surplus).
      if (!flip && countGender(other) > MIN_PER_BINARY_GENDER) {
        flip = drafts.find((d) => d.genderPresentation === other);
        if (flip) flip.coherenceFlipped = true;
      }
      if (!flip) break; // nothing flippable without dropping the other side below its floor — give up
      flip.genderPresentation = target;
    }
  }

  // ── 4. Nonbinary — assign a sparse few among UNISEX names (counts toward MIN_QUEER), capped ───────
  // Done after the binary floor so it never undercuts it: only flip a unisex draft to nonbinary while
  // BOTH binaries stay at/above their floor.
  let nb = drafts.filter((d) => d.genderPresentation === "nonbinary").length;
  for (const d of drafts) {
    if (nb >= MAX_NONBINARY) break;
    if (d.nameGender !== "unisex" || d.genderPresentation === "nonbinary") continue;
    if (discRng.next() >= 0.5) continue; // sparse + seeded — often not
    const from = d.genderPresentation;
    if (countGender(from) <= MIN_PER_BINARY_GENDER) continue; // never drop a binary below its floor
    d.genderPresentation = "nonbinary";
    nb++;
  }

  // ── 5. Repair — age-band spread (the AGES are byte-stable; the floor only VALIDATES + repairs the
  //     stored ages would re-baseline the stream, so instead we ASSERT via the report and, when a band
  //     is short, BUMP a surplus-band draft's age into the short band on the DEDICATED sub-stream — the
  //     age is NOT a competition input, so this never perturbs outcomes). ────────────────────────────
  const ageRng = new SeededRandom(hashSeed(`${seed}:diversity:age`));
  const bandCount = (id: string) => drafts.filter((d) => ageBandOf(d.age) === id).length;
  for (const band of AGE_BANDS) {
    let guard = 0;
    while (bandCount(band.id) < MIN_PER_AGE_BAND && guard++ < 100) {
      // Pull from the most-overfull band (one with > MIN_PER_AGE_BAND), so the spread evens out.
      const donorBand = [...AGE_BANDS]
        .filter((b) => b.id !== band.id && bandCount(b.id) > MIN_PER_AGE_BAND)
        .sort((a, b) => bandCount(b.id) - bandCount(a.id))[0];
      if (!donorBand) break;
      const donor = drafts.find((d) => ageBandOf(d.age) === donorBand.id);
      if (!donor) break;
      // A concrete in-band age (deterministic): the band floor + a seeded offset within the band.
      const span = Math.min(band.maxExclusive, 70) - band.min;
      donor.age = Math.max(AGE_ELIGIBILITY_FLOOR, band.min + ageRng.int(Math.max(1, span)));
    }
  }

  // ── 6. Repair — LGBTQ+ floor (queer orientations / nonbinary), counted across the cast ───────────
  const queerCount = () => drafts.filter((d) => countsQueer(d)).length;
  if (queerCount() < MIN_QUEER) {
    for (const d of drafts) {
      if (queerCount() >= MIN_QUEER) break;
      if (countsQueer(d)) continue;
      // Assign a seeded queer orientation (never nonbinary here — that's gender, repaired above).
      d.orientation = QUEER_ORIENTATIONS[orRng.int(QUEER_ORIENTATIONS.length)]!.orientation;
    }
  }

  // ── 7. Disclosure — character-driven: some queer houseguests are OUT (public), some PRIVATE ───────
  // A seeded per-houseguest roll (NOT a uniform rule). Only NON-straight orientations can be "private";
  // a straight orientation is simply public/unremarkable. A nonbinary-but-straight houseguest's gender
  // is public (presentation is observable) but carries no private-orientation secret.
  for (const d of drafts) {
    if (!isQueer(d.orientation)) { d.out = true; continue; }
    d.out = discRng.next() < PUBLICLY_OUT_PROB;
  }
  // §4/§5 guarantee: a season should reliably carry BOTH an out queer houseguest AND a private one when
  // it has ≥2 queer houseguests — so the scenarios always have a subject. If the roll made them ALL out
  // (or all private), flip exactly one of the queer-by-orientation drafts to the missing side.
  const queerByOrientation = drafts.filter((d) => isQueer(d.orientation));
  if (queerByOrientation.length >= 2) {
    if (!queerByOrientation.some((d) => !d.out)) queerByOrientation[queerByOrientation.length - 1]!.out = false;
    if (!queerByOrientation.some((d) => d.out)) queerByOrientation[0]!.out = true;
  }

  // ── 8. Split across the Vault Wall ───────────────────────────────────────────────────────────────
  const pub: Record<EntityId, PublicDiversityFacets> = {};
  const privateOrientations: Record<EntityId, Orientation> = {};
  for (const d of drafts) {
    // Name coheres when it was never flipped against a clearly-gendered name: a unisex name presents any
    // way, and a gendered name kept its name-gender. The bounded `coherenceFlipped` exception is false.
    const nameCoheres = !d.coherenceFlipped
      && (d.nameGender === "unisex"
        || (d.nameGender === "man" && d.genderPresentation === "man")
        || (d.nameGender === "woman" && d.genderPresentation === "woman")
        // a unisex name flipped to nonbinary still coheres; a gendered name to nonbinary does too only if
        // it was a unisex-origin draft — which `coherenceFlipped` already guards, so nonbinary here coheres.
        || d.genderPresentation === "nonbinary");
    pub[d.id] = {
      ethnicity: d.ethnicity.heritage,
      bipoc: d.ethnicity.bipoc,
      skinTone: d.ethnicity.skinTone,
      genderPresentation: d.genderPresentation,
      age: d.age,
      nameCoheres,
      ...(d.out && isQueer(d.orientation) ? { outOrientation: d.orientation } : {}),
    };
    if (isQueer(d.orientation) && !d.out) privateOrientations[d.id] = d.orientation;
  }
  return { public: pub, privateOrientations };
}

// ── Vault sealing helper for a private orientation (engine-only — never projected) ──────────────────
/** The Vault kind a sealed private orientation rides under (a hidden attribute; no schema change). */
export const PRIVATE_ORIENTATION_KIND = "hidden-attribute" as const;

/** Stable Vault id for one NPC's sealed private orientation (idempotent re-seal on restore). */
export function privateOrientationVaultId(sourceId: EntityId): string {
  return `private-orientation:${sourceId}`;
}

/** Serialize a private orientation to ONE engine-only Vault record content string (never projected). */
export function privateOrientationToVaultContent(sourceId: EntityId, orientation: Orientation): string {
  return `private-orientation ${sourceId}: ${orientation} (hidden — surfaces only via a 0002 pathway, never forced)`;
}

// ── §4.1 — orientation-aware showmance ELIGIBILITY (the 0059 tie) ───────────────────────────────────
// The full per-NPC identity the showmance plausibility predicate reads — assembled from the layer's
// PUBLIC facets + the (engine-only) private orientations. Used ONLY engine-side, never projected.
export interface ShowmanceIdentity {
  orientation: Orientation;
  genderPresentation: GenderPresentation;
}

/**
 * Reassemble each NPC's full identity (public + private orientation) from a generated layer — for the
 * 0059 showmance ELIGIBILITY check. Engine-only; the private orientation here never leaves the engine.
 */
export function showmanceIdentities(layer: DiversityLayer): Record<EntityId, ShowmanceIdentity> {
  const out: Record<EntityId, ShowmanceIdentity> = {};
  for (const [id, pub] of Object.entries(layer.public)) {
    const orientation: Orientation =
      pub.outOrientation ?? layer.privateOrientations[id] ?? "straight";
    out[id] = { orientation, genderPresentation: pub.genderPresentation };
  }
  return out;
}

/**
 * Is a romance between two houseguests PLAUSIBLE given their identities (owner decision #3 —
 * eligibility-only gating)? A QUEER showmance is a FIRST-CLASS possible pairing (the genesis design
 * explicitly wanted one), never a special case. The predicate is permissive by design — it only rules
 * OUT a pairing that makes no sense for both parties (e.g. two strictly straight same-gender houseguests,
 * or two strictly gay/lesbian different-gender houseguests). Bi/pan/queer pair with anyone. It NEVER
 * forces a showmance — the L40 sparseness/earned discipline still dominates; this only gates WHO is eligible.
 */
export function showmancePlausible(a: ShowmanceIdentity, b: ShowmanceIdentity): boolean {
  const sameGender = a.genderPresentation === b.genderPresentation;
  // "Open" orientations (attracted regardless of gender) make any pairing plausible from that side.
  const open = (o: Orientation): boolean => o === "bisexual" || o === "pansexual" || o === "queer";
  const attractedSame = (o: Orientation): boolean => open(o) || o === "gay" || o === "lesbian";
  const attractedDiff = (o: Orientation): boolean => open(o) || o === "straight";
  return sameGender
    ? attractedSame(a.orientation) && attractedSame(b.orientation)
    : attractedDiff(a.orientation) && attractedDiff(b.orientation);
}

// re-export so the cap is a single source of truth in tests/imports
export { MAX_PER_AGE_BAND };
