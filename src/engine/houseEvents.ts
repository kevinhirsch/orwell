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
 *     events, grounded in the current week/day and guaranteed to never repeat any of
 *     the last `RECENT_WINDOW` recorded house-events' content (the store is consulted,
 *     so the guarantee survives restarts — the store recalled, never module state
 *     remembered). A follow-up audit found the real call cadence lands several ambient
 *     picks per week (well above once/day), so a window of 1 (only the immediately
 *     preceding pick) let the pool cycle into visibly-repeating content within the
 *     first few weeks of a season — the window and the pool are both widened here.
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
  "A group workout in the yard turns into an impromptu strategy huddle.",
  "A surprise lockdown announcement scrambles everyone back inside mid-conversation.",
  "A broken air conditioner turns the living room into a shared complaint session.",
  "A themed wardrobe delivery for the week's competition sparks a costume-closet scramble.",
  "A spontaneous dance party in the kitchen pulls in half the house before curfew.",
  "A game night collapses into good-natured trash talk that lingers past midnight.",
  "A loud diary-room rehearsal through the wall draws snickers from the hallway.",
  "A laundry mix-up over borrowed clothes turns tense before cooler heads prevail.",
  "A surprise care-package photo stirs a wave of homesickness across the house.",
  "A thermostat standoff between hot and cold sleepers boils over at breakfast.",
  "A yard-game tournament gets unexpectedly competitive and a little personal.",
  "A journaling circle on the patio turns into an unplanned confession session.",
  "An early wake-up call for a surprise photo shoot leaves half the house grumbling.",
  "A shared photo album from home sparks a wave of nostalgia in the living room.",
  "A gardening chore assignment pairs up two unlikely houseguests for an afternoon.",
  "A missing snack stash reignites the never-ending kitchen-hoarding feud.",
  "A late-night round of confessions in the have-not room gets more honest than planned.",
  "A pool-pump breakdown cancels the afternoon swim and tempers rise in the heat.",
  "A surprise cleaning inspection sends the house scrambling before a live show.",
  "A birthday toast with makeshift decorations turns into a rare all-house gathering.",
];

export interface HouseEventOpts {
  week: number;
  phase: string;
}

/**
 * How many of the most-recently recorded house-events to check before picking a line, so a
 * busy week (several ambient picks) doesn't visibly repeat a line within a short stretch — a
 * window of 1 (only the immediately preceding pick) let a shallow pool cycle back into the
 * SAME line every ~12 picks, which reads as repetitive well inside an 11-week season (audit
 * finding). Scales with pool size so a deliberately small pool (e.g. in a focused test) never
 * empties the candidate set outright.
 */
const RECENT_WINDOW = Math.max(1, Math.min(10, HOUSE_EVENT_POOL.length - 1));

/**
 * The next meaningful, player-witnessed house event. Seeded (the rng decides), grounded
 * (week + day index prefix the content), and never a verbatim repeat of any of the last
 * `RECENT_WINDOW` recorded house-events — the store is queried for that recent stretch, and
 * the pick excludes any line already used in it (E58, widened by a follow-up audit).
 */
export function nextHouseEvent(events: EventStore, rng: RandomnessSource, opts: HouseEventOpts): string {
  const prior = events.query({ type: "house-event" });
  const recentContents = prior.slice(-RECENT_WINDOW).map((e) => e.content);
  const pool = HOUSE_EVENT_POOL.filter((line) => !recentContents.some((content) => content.includes(line)));
  // If the recency window ever exhausts the whole pool (only possible with an unusually
  // shallow custom pool, e.g. in a narrow test), fall back to the full pool rather than
  // indexing into an empty array — variety degrades gracefully, it never throws.
  const candidates = pool.length > 0 ? pool : HOUSE_EVENT_POOL;
  // ENG-3 (#628): rng.next() ∈ [0,1), so `Math.floor(rng.next() * candidates.length)` is
  // already in [0, candidates.length) — no trailing `% length` needed.
  const line = candidates[Math.floor(rng.next() * candidates.length)]!;
  const day = dayOfWeek(opts.phase);
  const stamp = day === null ? `Week ${opts.week}` : `Week ${opts.week}, day ${day}`;
  return `${stamp}: ${line}`;
}
