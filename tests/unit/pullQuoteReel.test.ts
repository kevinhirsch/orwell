import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { buildPullQuoteReel, type ReelEvent, type ReelDeps } from "../../src/engine/pullQuoteReel";
import { PULL_QUOTE } from "../../src/engine/pullQuoteConstants";

/**
 * Issue #1396 — the weekly Diary-Room pull-quote reel. A curated montage of the season's most notable
 * confessional lines — the player's OWN Diary Room AND the NPCs' Vault-held confessionals — collected BY
 * WEEK and surfaced ONLY at the 0048 retrospective unseal. Two things get proven here:
 *   (A) CURATION — the pure curator groups by week, keeps the notable lines within the caps, strips the
 *       bracket labels, and keeps the player-vs-NPC source distinction explicit.
 *   (B) THE VAULT WALL (mandate #2) — an NPC confessional line reaches the reel ONLY at the sanctioned
 *       unseal (post-season retrospective + the out-of-band `producerVault` debug), NEVER on any per-turn
 *       player or admin projection. Fail-before / pass-after.
 * HARD rule: roles only — no fixture names.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (A) CURATION — the pure curator over synthetic, fully-controlled inputs.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

const N1 = npc(1), N2 = npc(2), N3 = npc(3), N4 = npc(4);
const NAMES = new Map<EntityId, string>([
  [PLAYER, "The Player"], [N1, "NPC-1"], [N2, "NPC-2"], [N3, "NPC-3"], [N4, "NPC-4"],
]);
/** Identity scrub (the synthetic bodies carry no raw ids); the real `retroScrub` is exercised in (B). */
const DEPS: ReelDeps = { nameOf: (id) => NAMES.get(id) ?? id, scrub: (c) => c };

const conf = (init: EntityId, body: string): ReelEvent => ({ type: "confessional", initiator: init, hidden: true, content: `[confessional x] ${body}` });
const diary = (body: string): ReelEvent => ({ type: "diary-room", initiator: PLAYER, hidden: false, content: `[diary-room] ${body}` });
const evict = (): ReelEvent => ({ type: "house-event", initiator: N1, hidden: false, content: "The nominee is evicted" });

describe("#1396 (A) — the pull-quote reel curates by week, honours the caps, and tags every source", () => {
  it("groups quotes into eviction-delimited weeks, drops the inert line, and keeps player + NPC sources", () => {
    const log: ReelEvent[] = [
      conf(N1, "the nominee is gone — my biggest threat, I'm writing the name down"), // wk1 charge 5
      conf(N2, "I'm still reading the room quietly"),                                  // wk1 charge 0 → DROPPED
      diary("my real target is the HOH and I do not trust them, I will vote them out"),// wk1 charge 3
      evict(),                                                                          // → week 2
      conf(N3, "the veto winner scares me, they are my biggest threat"),               // wk2 charge 3
      conf(N1, "I trust the floater completely, ride-or-die to the end"),              // wk2 charge 2 → capped
      conf(N2, "I need to blindside them with a backdoor vote, coming for the nominee"),// wk2 charge 4
      evict(),                                                                          // → week 3
      conf(N4, "I feel untouchable, but the target on my back means war"),             // wk3 charge 3
    ];
    const reel = buildPullQuoteReel(log, DEPS);

    // Three eviction-delimited weeks, in order.
    expect(reel.map((w) => w.week)).toEqual([1, 2, 3]);

    // Week 1: the notable NPC line + the player's line — both kept (≤ perWeekCap), earliest-said first.
    expect(reel[0]!.quotes).toHaveLength(2);
    expect(reel[0]!.quotes[0]).toEqual({ source: "npc-confessional", speaker: "NPC-1", quote: "the nominee is gone — my biggest threat, I'm writing the name down" });
    expect(reel[0]!.quotes[1]).toEqual({ source: "player-diary", speaker: "The Player", quote: "my real target is the HOH and I do not trust them, I will vote them out" });
    // The inert line (charge below the notability floor) never made the reel.
    expect(JSON.stringify(reel)).not.toContain("still reading the room");

    // Week 2: exactly perWeekCap kept — the two MOST charged; the weakest (ride-or-die, charge 2) dropped.
    expect(reel[1]!.quotes).toHaveLength(PULL_QUOTE.perWeekCap);
    expect(JSON.stringify(reel[1])).not.toContain("ride-or-die");

    // Source distinction is explicit and BOTH channels appear across the reel.
    const sources = new Set(reel.flatMap((w) => w.quotes.map((q) => q.source)));
    expect(sources).toEqual(new Set(["npc-confessional", "player-diary"]));

    // Every quote is prefix-stripped — no `[confessional …]` / `[diary-room]` label ever shows.
    for (const w of reel) for (const q of w.quotes) {
      expect(q.quote).not.toContain("[confessional");
      expect(q.quote).not.toContain("[diary-room");
      expect(q.speaker.length).toBeGreaterThan(0);
    }
  });

  it("enforces the per-week cap and the season cap", () => {
    // One week with many eligible lines → capped to perWeekCap.
    const crowded = Array.from({ length: 6 }, (_, i) => conf(N1, `target ${i}: my biggest threat has to go, I vote to evict`));
    expect(buildPullQuoteReel(crowded, DEPS)[0]!.quotes.length).toBe(PULL_QUOTE.perWeekCap);

    // Many single-quote weeks → the whole reel is trimmed to the season cap.
    const manyWeeks: ReelEvent[] = [];
    for (let i = 0; i < PULL_QUOTE.seasonCap + 6; i++) { manyWeeks.push(conf(N1, `week ${i}: my target is a threat, I will vote`)); manyWeeks.push(evict()); }
    const reel = buildPullQuoteReel(manyWeeks, DEPS);
    const total = reel.reduce((n, w) => n + w.quotes.length, 0);
    expect(total).toBe(PULL_QUOTE.seasonCap);
    for (const w of reel) expect(w.quotes.length).toBeLessThanOrEqual(PULL_QUOTE.perWeekCap);
  });

  it("collapses a byte-identical repeated line within a week (a montage never repeats one quote)", () => {
    const dup = "my target is the biggest threat and I will vote them out";
    const reel = buildPullQuoteReel([conf(N1, dup), conf(N2, dup), conf(N3, "the veto winner is my target, coming for them")], DEPS);
    const quotes = reel.flatMap((w) => w.quotes.map((q) => q.quote));
    expect(quotes.filter((q) => q === dup)).toHaveLength(1); // the duplicate is dropped, the distinct line survives
    expect(quotes).toContain("the veto winner is my target, coming for them");
  });

  it("an empty log — or one with no confessional/diary lines — yields an empty reel", () => {
    expect(buildPullQuoteReel([], DEPS)).toEqual([]);
    expect(buildPullQuoteReel([evict(), { type: "house-event", initiator: N1, hidden: false, content: "the HOH is crowned" }], DEPS)).toEqual([]);
  });

  it("drops a line too short to be a real quote (the minLength floor), even when charged", () => {
    // "vote" is a charge term but the line is below minLength ⇒ excluded.
    expect(buildPullQuoteReel([conf(N1, "vote")], DEPS)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (B) THE VAULT WALL — an NPC confessional quote surfaces ONLY at the sanctioned unseal.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SENTINEL = "SENTINEL-1396-npc-confessional";
/** A maximally-charged planted confessional so it is guaranteed to win the notability caps and appear. */
const SENTINEL_CONF =
  `[confessional x] ${SENTINEL} my target is the biggest threat, I will vote to evict, nominate a backdoor ` +
  `blindside, betray who I trust, this is war and I feel untouchable, write the name down, they are gone and I am coming for them`;

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
}
function playToEnd(s: GameSessionAdapter): void {
  for (let i = 0; i < 4000; i++) {
    const v = s.advanceGame();
    if (v.pending) resolve(s, v.pending);
    if (v.finished) return;
  }
  throw new Error("the season did not finish within the drive budget");
}
function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("#1396 (B) — an NPC confessional quote reaches the reel ONLY at the sanctioned unseal (Vault Wall)", () => {
  it("is sealed from every per-turn player/admin surface while live, and unseals post-season", async () => {
    const { sb } = liveGame("reel-wall", 7);
    // Plant an off-screen NPC confessional (hidden, witness excludes the player) with a sentinel line.
    sb.engine.events.record({
      id: "reel-sentinel", ts: 1, type: "confessional",
      initiator: npc(1), witnessSet: [npc(1)], hidden: true, content: SENTINEL_CONF,
    });

    // FAIL-BEFORE: while the season is LIVE the confessional is Vault-sealed everywhere it could leak.
    expect(sb.session.seasonRetrospective()).toBeNull(); // the retrospective gate holds (no finished season)
    const liveSurfaces =
      JSON.stringify(sb.session.getGameState()) +
      JSON.stringify(sb.session.seasonRecap()) +
      JSON.stringify(sb.player.getVisibleState()) +
      JSON.stringify(await sb.mcp.admin.callTool("inspectNonVaultState", {})) +
      JSON.stringify(await sb.mcp.admin.callTool("sandboxHealth", {}));
    expect(liveSurfaces).not.toContain(SENTINEL);

    // The SANCTIONED live unseal (out-of-band `producerVault` debug — admin-only, explicit) DOES carry it
    // in the reel: that is the one owner-ruled exception, not a per-turn projection — so the reel rides the
    // exact same seam as the hidden story / eviction ballots.
    const liveDump = sb.session.producerVaultDump();
    expect(liveDump).not.toBeNull();
    expect(liveDump!.pullQuoteReel.some((w) => w.quotes.some((q) => q.source === "npc-confessional" && q.quote.includes(SENTINEL)))).toBe(true);

    // PASS-AFTER: once the season is finished the post-season retrospective unseals the reel with the line.
    playToEnd(sb.session);
    const retro = sb.session.seasonRetrospective();
    expect(retro).not.toBeNull();
    const npcQuotes = retro!.pullQuoteReel.flatMap((w) => w.quotes.filter((q) => q.source === "npc-confessional"));
    expect(npcQuotes.some((q) => q.quote.includes(SENTINEL))).toBe(true);
    // And the reel is genuinely populated from the real season's confessionals (non-vacuous).
    expect(retro!.pullQuoteReel.length).toBeGreaterThan(0);
    expect(npcQuotes.length).toBeGreaterThan(1);
    // The stripped quote never carries the bracket label.
    for (const q of npcQuotes) expect(q.quote).not.toContain("[confessional");
  });
});
