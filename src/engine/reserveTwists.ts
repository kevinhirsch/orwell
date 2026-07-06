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
 * Seed which reserved twists (≤ `count`) are actually in play and when each fires.
 * Rare by construction — each enabled slot is only ~50% likely to be loaded, and
 * even then fires once, at a seeded dramatic beat. Same seed ⇒ same result.
 */
export function loadReserveTwists(count: number, rng: RandomnessSource, totalBeats = 14): ReserveTwist[] {
  const slots = Math.max(0, Math.min(count, RESERVE_POOL.length));
  const out: ReserveTwist[] = [];
  for (let i = 0; i < slots; i++) {
    if (rng.next() < 1 - TWIST_LOAD_PROB) continue; // often none, even when enabled
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

// ─────────────────────────────────────────────────────────────────────────────
// REACTIVE model (feature 0025 redesign, PO ruling 2026-07-06). The whole pool stands
// armed from game start; each twist WATCHES the live house and fires when the house
// reaches a state that EARNS it — not a week pre-picked at setup. The trigger THRESHOLDS
// are re-rolled per season (the "dynamic triggers"), so the same conditions do not recur
// season to season; and even an earned trigger can be HELD BACK by a seeded per-season
// arming roll, so some seasons stay quiet. Everything here is PURE + seed-deterministic;
// the plan is Vault content (engine-only), sealed until a twist fires.
//
// Gated live behind ORWELL_REACTIVE_TWISTS — flag off keeps the legacy pre-scheduled path
// above (byte-identical), so the calibration baseline is untouched.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sealed per-season plan: the seeded thresholds that decide WHEN each twist becomes
 * eligible, plus whether each is armed at all this season (the hold-back). Re-rolled fresh
 * every season, so no two playthroughs share the same trigger conditions.
 */
export interface TwistPlan {
  /** Fire the double eviction the first week the active house is at or below this size. */
  doubleEvictionAtActive: number;
  doubleEvictionArmed: boolean;
  /** Fire the secret power once the lopsided-eviction streak reaches this length. */
  secretPowerStreak: number;
  secretPowerArmed: boolean;
  /** Fire the battle-back once this many jurors have been seated (early-jury window). */
  battleBackAtJury: number;
  battleBackArmed: boolean;
}

/** The compact live-house snapshot the triggers read (roles/counts only — no identities). */
export interface TwistSignals {
  /** Houseguests still in the game. */
  activeCount: number;
  /** Jurors seated so far (0 before the jury phase). */
  juryCount: number;
  /** Consecutive near-unanimous ("the house steamrolled") evictions — the lopsided-house signal. */
  lopsidedStreak: number;
}

/** The seeded threshold bands (the "dynamic" ranges the per-season pick is drawn from). */
export const DOUBLE_EVICTION_ACTIVE_BAND: readonly [number, number] = [6, 9];
export const SECRET_POWER_STREAK_BAND: readonly [number, number] = [2, 3];
export const BATTLE_BACK_JURY_BAND: readonly [number, number] = [1, 3];
/** Chance an enabled twist is actually armed this season (else it is held back — some seasons stay quiet). */
export const TWIST_ARM_PROB = 0.6;
/** Below this many active houseguests, no NEW twist arms — too little game left to stay format-preserving. */
export const TWIST_MIN_ACTIVE = 5;

function pickInBand(rng: RandomnessSource, [lo, hi]: readonly [number, number]): number {
  return lo + rng.int(hi - lo + 1);
}

/**
 * Roll the sealed per-season twist plan (the dynamic thresholds + the hold-back arming). Drawn in a
 * FIXED field order off the given (dedicated, per-season) rng, so the same seed reproduces the same
 * plan and a different seed yields different trigger conditions.
 */
export function planReserveTwists(rng: RandomnessSource): TwistPlan {
  return {
    doubleEvictionAtActive: pickInBand(rng, DOUBLE_EVICTION_ACTIVE_BAND),
    doubleEvictionArmed: rng.next() < TWIST_ARM_PROB,
    secretPowerStreak: pickInBand(rng, SECRET_POWER_STREAK_BAND),
    secretPowerArmed: rng.next() < TWIST_ARM_PROB,
    battleBackAtJury: pickInBand(rng, BATTLE_BACK_JURY_BAND),
    battleBackArmed: rng.next() < TWIST_ARM_PROB,
  };
}

/**
 * Which twist (if any) is triggered by the live house RIGHT NOW, given the sealed plan, the current
 * signals, and what has already fired (each fires at most once). Returns at most one — so the caller,
 * evaluating once per week roll, naturally spaces twists across different weeks (the cooldown). The
 * order below is the priority when two are eligible the same roll; the deferred one persists (its
 * threshold is monotonic) and fires the next roll.
 */
export function triggeredTwist(
  plan: TwistPlan,
  sig: TwistSignals,
  fired: readonly TwistKind[],
): TwistKind | null {
  const done = new Set(fired);
  if (sig.activeCount < TWIST_MIN_ACTIVE) return null; // too little game left to stay format-preserving
  // Battle-back first: its early-jury window is the narrowest and closes as the jury fills.
  if (plan.battleBackArmed && !done.has("battle-back") && sig.juryCount >= plan.battleBackAtJury && sig.juryCount <= plan.battleBackAtJury + 1)
    return "battle-back";
  // Double eviction: the first week the house has shrunk to the seeded target size.
  if (plan.doubleEvictionArmed && !done.has("double-eviction") && sig.activeCount <= plan.doubleEvictionAtActive)
    return "double-eviction";
  // Secret power: the house has gone lopsided (a run of steamroll evictions).
  if (plan.secretPowerArmed && !done.has("secret-power") && sig.lopsidedStreak >= plan.secretPowerStreak)
    return "secret-power";
  return null;
}
