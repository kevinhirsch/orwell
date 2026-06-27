import type { RandomnessSource } from "../ports/RandomnessSource";
import type { Soul, HiddenElement } from "./characterFactory";
import { TRIGGER, type EruptionKind, ERUPTION_POOL } from "./triggerConstants";

/**
 * Trigger secrets fire house events (feature 0091) — pure engine functions.
 *
 * A houseguest's volatile, sealed trigger attribute fires an emergent, Vault-safe
 * public house event when accumulated soul strain meets a precipitant + a temperature
 * roll. The engine owns whether, which, and how big; the model only voices the public
 * eruption. The Vault Wall holds: the player learns the ERUPTION, never the TRIGGER.
 *
 * Pure, no I/O, no Vault handle — reads only the already-decoded soul + trigger data.
 */

/**
 * The fire-signal strength for a particular trigger — how primed it is RIGHT NOW.
 * 0..1 where 1 = virtually certain to fire on a check, 0 = dormant.
 */
export function pressure(npcSoul: Soul, trigger: HiddenElement): number {
  if (!trigger.volatility || !trigger.eruptionKind) return 0;
  const strain = 1 - npcSoul.emotionalState; // distress — low state = high strain
  const strainSignal = strain * TRIGGER.strainWeight;
  const volatilitySignal = trigger.volatility * (1 - TRIGGER.strainWeight);
  return Math.max(0, Math.min(1, strainSignal + volatilitySignal));
}

/**
 * Whether this trigger FIRES this check. Requires a precipitant (no cold open —
 * a quiet stretch can't detonate anyone) and a seeded temperature roll <
 * pressure × fireRate. A trigger whose `fired` flag is true never fire again
 * (one-shot — monotonic flag).
 */
export function shouldFire(
  trigger: HiddenElement,
  strain: number,
  precipitant: boolean,
  rng: RandomnessSource,
): boolean {
  if (!trigger.volatility || !trigger.eruptionKind || trigger.fired) return false;
  if (!precipitant) return false; // no cold open
  const p = Math.max(0, Math.min(1, strain * trigger.volatility)); // combined pressure
  return rng.next() < p * TRIGGER.fireRate;
}

/**
 * Select the next eruption house-event line from the pool for `kind`. The anti-repeat
 * pattern (mirroring `nextHouseEvent`): exclude the prior recorded eruption content so
 * two consecutive eruptions never share a line. The caller supplies `priorContent`
 * (the content of the last recorded eruption, or null for the first).
 */
export function eruptionEvent(
  kind: EruptionKind,
  priorContent: string | null,
  rng: RandomnessSource,
): string {
  const pool = (ERUPTION_POOL[kind] ?? ERUPTION_POOL["blow-up"])
    .filter((line) => priorContent === null || !priorContent.includes(line));
  return pool[Math.floor(rng.next() * pool.length)]!;
}
