import type { RandomnessSource } from "../ports/RandomnessSource";

/**
 * The weekly loop's day scheduler (Clock/Scheduler). A "week" is one HOH reign —
 * HOH competition → eviction — not a fixed number of calendar days. Every day
 * carries at least one meaningful event; pacing is tight and ceremony-driven, so
 * a week allows at MOST one optional social day (often none), and even that day
 * carries a significant house event.
 */
export type DayKind =
  | "hoh-comp" | "nominations" | "veto-comp" | "veto-ceremony" | "eviction" | "house-event";

export interface Day {
  week: number;
  kind: DayKind;
  isSocial: boolean;
  significantHouseEvent: boolean;
}

const CEREMONY_BEATS: readonly DayKind[] = ["hoh-comp", "nominations", "veto-comp", "veto-ceremony", "eviction"];
const MEANINGFUL = new Set<DayKind>([...CEREMONY_BEATS, "house-event"]);

/** Often none: probability a week includes its one optional social day. */
const SOCIAL_DAY_PROB = 0.25;

export function isMeaningful(day: Day): boolean {
  return MEANINGFUL.has(day.kind) || day.significantHouseEvent;
}

export function scheduleWeek(week: number, rng: RandomnessSource): Day[] {
  const days: Day[] = CEREMONY_BEATS.map((kind) => ({
    week, kind, isSocial: false, significantHouseEvent: kind === "eviction",
  }));

  // At most one optional social day, inserted before the eviction so the week
  // still ends on an eviction. It always carries a significant house event.
  if (rng.next() < SOCIAL_DAY_PROB) {
    const pos = 1 + rng.int(CEREMONY_BEATS.length - 1); // positions 1..4 (never after eviction)
    days.splice(pos, 0, { week, kind: "house-event", isSocial: true, significantHouseEvent: true });
  }
  return days;
}

export function simulateSeasonSchedule(rng: RandomnessSource, weeks: number): Day[] {
  const all: Day[] = [];
  for (let w = 0; w < weeks; w++) all.push(...scheduleWeek(w, rng));
  return all;
}

export function weeksOf(days: Day[]): Day[][] {
  const byWeek = new Map<number, Day[]>();
  for (const d of days) {
    const list = byWeek.get(d.week) ?? [];
    list.push(d);
    byWeek.set(d.week, list);
  }
  return [...byWeek.keys()].sort((a, b) => a - b).map((k) => byWeek.get(k)!);
}
