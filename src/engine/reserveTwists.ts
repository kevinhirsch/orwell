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
export type TwistKind = "secret-power" | "double-eviction" | "battle-back";

/** Curated, format-preserving pool. */
export const RESERVE_POOL: readonly TwistKind[] = ["secret-power", "double-eviction", "battle-back"];

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
 * Seed which reserved twists (≤ `count`) are actually in play and when each fires.
 * Rare by construction — each enabled slot is only ~50% likely to be loaded, and
 * even then fires once, at a seeded dramatic beat. Same seed ⇒ same result.
 */
export function loadReserveTwists(count: number, rng: RandomnessSource, totalBeats = 14): ReserveTwist[] {
  const slots = Math.max(0, Math.min(count, RESERVE_POOL.length));
  const out: ReserveTwist[] = [];
  for (let i = 0; i < slots; i++) {
    if (rng.next() < 0.5) continue; // often none, even when enabled
    const kind = RESERVE_POOL[rng.int(RESERVE_POOL.length)]!;
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
