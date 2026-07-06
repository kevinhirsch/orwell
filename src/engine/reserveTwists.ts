import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Reserve twists (feature 0025) — a small curated pool of classic, NON-STRUCTURAL
 * production twists held in reserve. The engine decides, seeded, WHETHER a reserved
 * twist is in play and WHEN it fires (a dramatic beat). Until it fires, the choice
 * and its timing are Vault-sealed — invisible to the player AND the admin (mandate
 * #2). Firing reveals it as a witnessed event. Twists never break the core arc
 * (16 → jury-9 → final-2) or the hard rules (0005); they add variance along the way.
 *
 * PURE + seed-deterministic. The chosen twists are Vault content (engine-only);
 * this module only computes them — it never surfaces them.
 */
// BE-15: named "wildcard-power" (never "secret-power") — the unrelated, fully-built 0093 feature
// ("secrets as leverage/currency") already owns "secret power" vocabulary; a reserve-twist kind sharing
// that name risked a future maintainer wiring the wrong system or assuming 0093 implements this twist.
export type TwistKind = "wildcard-power" | "double-eviction" | "battle-back";

/** Curated, format-preserving pool. May hold more kinds than the live loop currently implements — see
 *  `IMPLEMENTED_TWISTS`/`DOCUMENTED_UNIMPLEMENTED_TWISTS` below, which together must account for every
 *  kind here (BE-14's same-file guard). */
export const RESERVE_POOL: readonly TwistKind[] = ["wildcard-power", "double-eviction", "battle-back"];

/**
 * BE-3/BE-14 — the twist kinds the LIVE loop actually implements a firing handler for. Single source of
 * truth, co-located with `RESERVE_POOL` in this file (previously duplicated as a local constant in
 * `GameSessionAdapter.ts`, with nothing tying the two together). `loadReserveTwists` draws ONLY from
 * this set (never the full pool) — see the fix note there for why that matters.
 */
export const IMPLEMENTED_TWISTS: ReadonlySet<TwistKind> = new Set<TwistKind>(["double-eviction"]);

/**
 * BE-14 — kinds in `RESERVE_POOL` that are DELIBERATELY not yet wired into the live loop (reserved for a
 * later wave), documented here so a future addition to the pool can't silently go unaccounted for. Every
 * kind in `RESERVE_POOL` must be in `IMPLEMENTED_TWISTS` or here — the assertion below enforces it.
 */
const DOCUMENTED_UNIMPLEMENTED_TWISTS: ReadonlySet<TwistKind> = new Set<TwistKind>(["wildcard-power", "battle-back"]);

// BE-14 — a same-file structural guard, checked once at module load: if a future kind is added to
// `RESERVE_POOL` without being wired into `IMPLEMENTED_TWISTS` OR explicitly documented above as a
// future reserve slot, fail loudly instead of silently shipping a phantom twist that can be seeded and
// sealed to the Vault but can never fire (the exact class of bug BE-3 fixes for the pre-existing kinds).
for (const kind of RESERVE_POOL) {
  if (!IMPLEMENTED_TWISTS.has(kind) && !DOCUMENTED_UNIMPLEMENTED_TWISTS.has(kind)) {
    throw new Error(
      `reserveTwists: RESERVE_POOL kind "${kind}" is neither IMPLEMENTED_TWISTS nor DOCUMENTED_UNIMPLEMENTED_TWISTS — account for it in src/engine/reserveTwists.ts`,
    );
  }
}

/** Chance an enabled reserve slot actually loads a twist (B59 — tunable, often none fire). */
export const TWIST_LOAD_PROB = 0.5;

/** A loaded-but-SEALED reserve twist: what it is and the (hidden) beat it fires at. */
export interface ReserveTwist {
  kind: TwistKind;
  fireAtBeat: number;
}

export interface TwistEvent {
  kind: TwistKind;
  beat: number;
}

/** The weekly eviction beats are the season's dramatic beats a twist may fire at. */
export function isDramaticBeat(beat: number, totalBeats = 14): boolean {
  return beat >= 2 && beat <= totalBeats - 1;
}

/**
 * BE-3 — the pool `loadReserveTwists` actually draws a KIND from: restricted to `IMPLEMENTED_TWISTS`.
 * The pre-existing bug drew from the FULL curated `RESERVE_POOL` and filtered unimplemented kinds OUT
 * AFTER the pick (at the `GameSessionAdapter` call site), which wasted 2 of every 3 loaded slots on a
 * twist that could never fire — silently diluting the effective load rate for the one shipped twist to
 * roughly a THIRD of the documented ~50% (`TWIST_LOAD_PROB`). Filtering the pool BEFORE the draw (never
 * reordering or adding rng calls) keeps the seeded draw SHAPE — one coin-flip `next()`, then one kind
 * `int()`, then one fireAtBeat `int()`, per loaded slot — byte-identical; only the mapping from the
 * kind-draw's random value to a `TwistKind` changes (ENDGAME-16/ENDGAME-7).
 */
const IMPLEMENTED_POOL: readonly TwistKind[] = RESERVE_POOL.filter((k) => IMPLEMENTED_TWISTS.has(k));

/**
 * Seed which reserved twists (≤ `count`) are actually in play and when each fires.
 * Rare by construction — each enabled slot is only ~50% likely to be loaded, and
 * even then fires once, at a seeded dramatic beat. Same seed ⇒ same result.
 */
export function loadReserveTwists(count: number, rng: RandomnessSource, totalBeats = 14): ReserveTwist[] {
  const slots = Math.max(0, Math.min(count, RESERVE_POOL.length));
  const out: ReserveTwist[] = [];
  for (let i = 0; i < slots; i++) {
    if (rng.next() < 1 - TWIST_LOAD_PROB) continue; // often none, even when enabled
    if (IMPLEMENTED_POOL.length === 0) continue; // nothing implemented yet ⇒ this slot loads nothing
    const kind = IMPLEMENTED_POOL[rng.int(IMPLEMENTED_POOL.length)]!;
    // A dramatic mid-season beat (never the premiere, never the finale week).
    const fireAtBeat = 2 + rng.int(Math.max(1, totalBeats - 3));
    out.push({ kind, fireAtBeat });
  }
  return out;
}

/** At a given beat, the reserved twist (if any) that fires now — deterministic, rare. */
export function maybeFireTwist(beat: number, reserve: readonly ReserveTwist[]): TwistEvent | null {
  const t = reserve.find((r) => r.fireAtBeat === beat);
  return t ? { kind: t.kind, beat } : null;
}

/** Play out the season's beats and collect the twists that fire (≤ the loaded count). */
export function firedTwists(reserve: readonly ReserveTwist[], totalBeats = 14): TwistEvent[] {
  const out: TwistEvent[] = [];
  for (let beat = 1; beat <= totalBeats; beat++) {
    const ev = maybeFireTwist(beat, reserve);
    if (ev) out.push(ev);
  }
  return out;
}
