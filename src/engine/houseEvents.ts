import type { EventStore } from "../ports/EventStore";
import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * Varied, state-derived house-event content + the week's day index (audit E58).
 *
 * The daily-event invariant (0008) used to be satisfied by ONE verbatim filler line
 * ("A house meeting shifts the week."), repeated forever — it polluted THE RECORD's
 * re-entry facts and handed the narrator a script to recite (ADR 0003 violation: the
 * engine hands the model FACTS to voice, never one canned sentence). This module owns:
 *
 *  1. `dayOfWeek(phase)` — the canonical beat→day mapping (HOH=1 … eviction=5), so the
 *     live game finally has an in-game day index derived from the ceremony cadence.
 *  2. `nextHouseEvent(...)` — a seeded pick from a curated pool of meaningful house
 *     events, grounded in the current week/day and guaranteed to never repeat the
 *     immediately preceding house-event's content (the store is consulted, so the
 *     guarantee survives restarts — the store recalled, never module state remembered).
 *
 * Pure and Vault-free: the lines are public, player-witnessed happenings (facts the
 * narrator may dress in its own voice); no name, stat, or hidden state is baked in.
 */

/** The canonical weekly cadence: Day 1 HOH → Day 2 noms → Day 3 veto comp → Day 4 ceremony → Day 5 eviction. */
export function dayOfWeek(phase: string): number | null {
  const p = phase.toLowerCase();
  if (p.includes("hoh")) return 1;
  if (p.includes("nomination")) return 2;
  if (p.includes("veto") && p.includes("cerem")) return 4;
  if (p.includes("veto")) return 3;
  if (p.includes("evict")) return 5;
  if (p.includes("final") || p.includes("jury")) return 5;
  return null; // pre-game / premiere / non-week moments carry no day index
}

/**
 * The variety pool. Each line is a complete, voiceable public happening — concrete
 * enough to be a real RECORD fact, generic enough to fit any cast (no names; the
 * narrator attaches people in its own voice). Keep every line meaningful (0008):
 * a significant house event, never empty filler.
 */
export const HOUSE_EVENT_POOL: ReadonlyArray<string> = [
  "A house meeting over food and chores boils into a shouting match before it settles.",
  "A slop week hits the have-nots and tempers fray by mid-afternoon.",
  "A luxury reward splits the house into winners celebrating and losers sulking.",
  "A late-night kitchen clean-up turns into a whispered debrief of the week so far.",
  "A backyard workout session becomes a quiet summit between unlikely partners.",
  "A practical joke war escalates until Big Brother calls the house to order.",
  "A care-package delivery stirs jealousy over who got remembered from home.",
  "A rainy lockdown crams everyone inside and old grievances resurface.",
  "A trivia rehearsal in the living room turns competitive enough to draw a crowd.",
  "A pantry shortage sparks an argument about who has been hoarding snacks.",
  "A hammock conversation runs long and the patio empties around it.",
  "A house-wide hide-and-seek of a missing personal item ends in an awkward discovery.",
];

export interface HouseEventOpts {
  week: number;
  phase: string;
}

/**
 * The next meaningful, player-witnessed house event. Seeded (the rng decides), grounded
 * (week + day index prefix the content), and never a verbatim repeat of the previous
 * house-event — the store is queried for the last recorded `house-event`, and the pick
 * excludes its line, so two consecutive house events can never share content (E58).
 */
export function nextHouseEvent(events: EventStore, rng: RandomnessSource, opts: HouseEventOpts): string {
  const prior = events.query({ type: "house-event" });
  const lastContent = prior.length > 0 ? prior[prior.length - 1]!.content : null;
  const pool = HOUSE_EVENT_POOL.filter((line) => lastContent === null || !lastContent.includes(line));
  const line = pool[Math.floor(rng.next() * pool.length) % pool.length]!;
  const day = dayOfWeek(opts.phase);
  const stamp = day === null ? `Week ${opts.week}` : `Week ${opts.week}, day ${day}`;
  return `${stamp}: ${line}`;
}
