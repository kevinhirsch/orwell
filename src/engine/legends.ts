/**
 * Feature 0101 — NPC myth-making: the notable-act SELECTOR. Pure, no I/O, no Vault handle. It scans the
 * player's own already-recorded, PUBLIC ceremony-beat ledger (the `season:*` house-event records every
 * weekly-loop beat already writes via `registry.ts`'s `session.setOnEvent` wiring) for the rare,
 * high-salience acts worth the house turning into a legend. It READS the ledger; it records nothing and
 * invents no happening (`docs/features/0101-npc-myth-making.md`).
 *
 * Classification matches CONTENT against the player's own display name because by the time a beat
 * reaches the EventStore it is already HUMANIZED (`GameSessionAdapter.humanize` rewrites the raw entity
 * ids in `BeatEvent.content` to display names before recording) — the same content-substring convention
 * `triggers.ts`/`houseEvents.ts` already use for classification (there keyed on the live PHASE string;
 * here keyed on the beat's authored `liveSeason.ts` content templates instead, since a coarse single
 * `type: "house-event"` is all every weekly-loop beat carries — see `richness.ts`'s identical `season:`
 * id-prefix convention). This is intentionally a SMALL, curated set (the spec's open question #1 — start
 * small, tune felt against the UAT): a comp win, a veto save, and a bold ceremony move. A selector this
 * narrow only ever under-selects (misses a notable act) — it can never mis-attribute one to someone else,
 * because the FIRST token match is the player's own display name.
 */
import type { GameEvent } from "../domain/event";

/** The small, curated notable-act taxonomy (0101 open question #1). */
export type NotableActClass = "hoh-win" | "veto-win" | "veto-save" | "nominations" | "finale-win";

/** One notable act found in the ledger — the source event's lineage + its class + when it happened. */
export interface NotableAct {
  /** The source event's stable id (traceable lineage). */
  eventId: string;
  actClass: NotableActClass;
  /** The event store's monotonic tick (`GameEvent.ts`) — callers use this as a watermark so a used act
   *  is never re-selected (see `GameSessionAdapter.legendTick`'s `legendLastActTick`). */
  ts: number;
}

/**
 * Scan `events` (typically `EventStore.query({ witnessedBy: PLAYER })`) for notable player acts recorded
 * STRICTLY AFTER `sinceTick` — the caller's watermark, so a consumed act is never re-selected. Reads only
 * the player-witnessed public ceremony ledger; records nothing, mints nothing. Deterministic (a pure scan
 * + string match — no rng here; the CALLER's dedicated rng decides whether/which to seed a legend from).
 */
export function notablePlayerActs(
  events: readonly GameEvent[],
  playerName: string,
  sinceTick: number,
): NotableAct[] {
  const acts: NotableAct[] = [];
  for (const e of events) {
    if (e.ts <= sinceTick) continue;
    // The weekly-loop ceremony ledger is coarsely typed `"house-event"` with a `season:<n>` id (the SAME
    // convention `richness.ts`'s `liveRichnessMetrics` already relies on to isolate ceremony beats from
    // social scenes) — never a hidden/off-screen record, so this never reads Vault-adjacent content.
    if (e.type !== "house-event" || !e.id.startsWith("season:")) continue;
    const actClass = classifyNotableAct(e.content, playerName);
    if (actClass) acts.push({ eventId: e.id, actClass, ts: e.ts });
  }
  return acts;
}

/** Match a humanized beat's content against the player's own name for a small, curated set of
 *  high-salience act classes. `null` for every ordinary beat (nominations by someone else, a comp round,
 *  a non-notable ceremony line, etc.) — most beats classify to nothing, by design (mandate: rare). */
function classifyNotableAct(content: string, playerName: string): NotableActClass | null {
  if (!playerName || !content.startsWith(playerName)) return null;
  const rest = content.slice(playerName.length);
  if (rest.startsWith(" wins the final Head of Household") || rest.startsWith(" wins Head of Household")) {
    return "hoh-win";
  }
  if (rest.startsWith(" wins the Power of Veto")) return "veto-win";
  // "uses the veto on themselves" is a self-save — less of a "house folklore" beat than saving another;
  // v1 keeps the selector narrow and skips it (a simplification the spec's open question #1 sanctions).
  if (rest.startsWith(" uses the veto on") && !rest.startsWith(" uses the veto on themselves")) {
    return "veto-save";
  }
  if (rest.startsWith(" nominates ")) return "nominations";
  if (rest.startsWith(" wins the season over ")) return "finale-win";
  return null;
}
