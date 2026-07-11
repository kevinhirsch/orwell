import type { EntityId } from "../domain/ids";
import { PULL_QUOTE } from "./pullQuoteConstants";

/**
 * Issue #1396 — the weekly Diary-Room pull-quote reel (the PURE curator). Given the recorded event log,
 * it selects the season's most notable Diary-Room lines and organises them by week for the 0048
 * retrospective. It is a pure, read-time PROJECTION over lines the game already composed:
 *
 *   • NO rng, NO event record, NO state mutation — so the seeded competition/vote/jury spine is
 *     byte-identical whether or not it runs (mandate #3 / ADR 0005; `pullQuoteReelNeutral.test.ts`).
 *   • Vault Wall (mandate #2): NPC confessional lines are Vault content. This function is a ranker only;
 *     the CALLER (`GameSessionAdapter.buildVaultUnseal`) runs it exclusively inside the one sanctioned
 *     post-season / admin-debug unseal — so a confessional quote reaches the reel ONLY there, never a
 *     per-turn player or admin projection (`pullQuoteReel.test.ts` Vault sentinel).
 *
 * Determinism (0007): weeks are reconstructed from INSERTION ORDER (the log position, exactly as
 * `selectRecentForConfessional` does), delimited by the canonical eviction announcement — never from a
 * timestamp (event `ts` values come from different monotonic counters and would not align). Same log ⇒
 * same reel, every read.
 */

/** Which channel a quote came from: an NPC's Vault-held confessional, or the player's own OOC Diary Room. */
export type PullQuoteSource = "npc-confessional" | "player-diary";

export interface PullQuote {
  /** The channel — kept EXPLICIT so the player's own line is never conflated with a sealed NPC one. */
  source: PullQuoteSource;
  /** The speaker's PUBLIC display name (the confessing houseguest, or the player). Never a raw id. */
  speaker: string;
  /** The line itself — prefix-stripped and id-resolved (Vault-free once curated here — see the module doc). */
  quote: string;
}

/** One week's slice of the reel: its most notable quotes, in the order they were said. */
export interface PullQuoteWeek {
  /** The 1-based week segment (delimited by evictions in the recorded log). */
  week: number;
  /** The week's kept quotes (bounded by `PULL_QUOTE.perWeekCap`), earliest-said first. */
  quotes: PullQuote[];
}

/** The minimal, Vault-safe view of a recorded event the curator needs (a structural subset of `GameEvent`). */
export interface ReelEvent {
  type: string;
  initiator: EntityId;
  content: string;
  hidden: boolean;
}

export interface ReelDeps {
  /** id → PUBLIC display name (non-Vault: names are public roster facts). */
  nameOf: (id: EntityId) => string;
  /** The retrospective id-resolver/scrub applied to a line (Vault-free; idempotent). */
  scrub: (content: string) => string;
}

/** The bracket labels the composer prepends; stripped so the reel shows the bare line. */
const CONFESSIONAL_PREFIX = /^\[confessional[^\]]*\]\s*/;
const DIARY_PREFIX = /^\[diary-room\]\s*/;

interface Candidate extends PullQuote {
  /** The reconstructed week (log-position segment). */
  week: number;
  /** The line's global insertion index — the deterministic tiebreak (earliest first) + intra-week order. */
  order: number;
  /** The notability score: how many distinct `chargeTerms` the line carries. */
  charge: number;
}

/** The notability signal: how many distinct notable terms the line carries (case-insensitive substrings). */
function chargeOf(text: string): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const term of PULL_QUOTE.chargeTerms) if (lower.includes(term)) n += 1;
  return n;
}

/** True when a PUBLIC beat is the canonical eviction announcement that closes a week. */
function isEvictionMarker(e: ReelEvent): boolean {
  return e.type === "house-event" && !e.hidden && e.content.includes(PULL_QUOTE.evictionCue);
}

/** Turn a confessional / diary-room event into a scored candidate, or null when it is neither / too thin. */
function toCandidate(e: ReelEvent, week: number, order: number, deps: ReelDeps): Candidate | null {
  let source: PullQuoteSource;
  let prefix: RegExp;
  if (e.type === "confessional") {
    source = "npc-confessional";
    prefix = CONFESSIONAL_PREFIX;
  } else if (e.type === "diary-room") {
    source = "player-diary";
    prefix = DIARY_PREFIX;
  } else {
    return null;
  }
  // Strip the bracket label FIRST (from the raw content), THEN scrub the body for any raw ids — so the
  // scrub can never interact with the label and the quote is clean, id-resolved prose.
  const quote = deps.scrub(e.content.replace(prefix, "")).trim();
  if (quote.length < PULL_QUOTE.minLength) return null;
  const charge = chargeOf(quote);
  if (charge < PULL_QUOTE.minCharge) return null;
  return { source, speaker: deps.nameOf(e.initiator), quote, week, order, charge };
}

/**
 * Build the reel: the most notable Diary-Room quotes across the season, grouped by week. Pure + bounded:
 *   1. Walk the log in insertion order; each eviction announcement advances the week counter.
 *   2. Collect confessional / diary-room lines as scored candidates at their week.
 *   3. Per week, keep the top `perWeekCap` by (charge desc, order asc), skipping an exact duplicate line.
 *   4. Globally keep the top `seasonCap` survivors by (charge desc, order asc).
 *   5. Regroup by week (ascending); within a week, earliest-said first.
 * Empty log (or no confessional/diary lines) ⇒ `[]`.
 */
export function buildPullQuoteReel(events: readonly ReelEvent[], deps: ReelDeps): PullQuoteWeek[] {
  const byWeek = new Map<number, Candidate[]>();
  let week = 1;
  let order = 0;
  for (const e of events) {
    if (isEvictionMarker(e)) {
      week += 1; // the eviction closes this week; later lines belong to the next
      continue;
    }
    const cand = toCandidate(e, week, order, deps);
    order += 1;
    if (!cand) continue;
    const list = byWeek.get(cand.week) ?? [];
    if (list.length === 0) byWeek.set(cand.week, list);
    list.push(cand);
  }

  // Per-week selection: rank by notability then recency, keep the cap, drop an exact-duplicate line.
  const kept: Candidate[] = [];
  for (const list of byWeek.values()) {
    list.sort((a, b) => b.charge - a.charge || a.order - b.order);
    const seen = new Set<string>();
    for (const c of list) {
      if (seen.has(c.quote)) continue;
      seen.add(c.quote);
      kept.push(c);
      if (seen.size >= PULL_QUOTE.perWeekCap) break;
    }
  }

  // Season cap: keep the globally most notable survivors.
  kept.sort((a, b) => b.charge - a.charge || a.order - b.order);
  const survivors = new Set(kept.slice(0, PULL_QUOTE.seasonCap));

  // Regroup by week (ascending), quotes within a week earliest-said first.
  const finalByWeek = new Map<number, Candidate[]>();
  for (const c of kept) {
    if (!survivors.has(c)) continue;
    const list = finalByWeek.get(c.week) ?? [];
    if (list.length === 0) finalByWeek.set(c.week, list);
    list.push(c);
  }
  return [...finalByWeek.keys()]
    .sort((a, b) => a - b)
    .map((wk) => ({
      week: wk,
      quotes: finalByWeek
        .get(wk)!
        .sort((a, b) => a.order - b.order)
        .map(({ source, speaker, quote }) => ({ source, speaker, quote })),
    }));
}
