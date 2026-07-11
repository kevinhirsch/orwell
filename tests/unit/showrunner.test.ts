import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  composeShowrunnerNote, emphasisForThread, scoreThread, showrunnerNoteToProse,
  type ThreadSignal,
} from "../../src/engine/showrunner";
import { SHOWRUNNER } from "../../src/engine/showrunnerConstants";
import { GameSessionRegistry } from "../../src/composition/registry";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { UserSandbox } from "../../src/composition/registry";
import type { StoryThread, SeasonPosition } from "../../src/engine/deepProfile";

/**
 * Feature 0101 (#1401) — the AI SHOWRUNNER. A DETERMINISTIC, SEEDED "producer's notes" pass that PACES
 * the season's arcs by proposing which SIMMERING hidden threads the next off-screen tick should EMPHASIZE.
 * Pure ADR 0005: the note proposes SHAPE (which threads, relative emphasis), the engine keeps every
 * outcome / magnitude / cap. These tests cover the PURE heuristic + the DoD behavioral claim ("the
 * weighted thread surfaces first"). The Vault-held and closed-set-neutral MANDATE proofs live in the
 * sibling boundary tests (showrunnerVaultHeld / showrunnerOutcomeNeutral). HARD rule: roles only, no names.
 */

// ── the pure heuristic ─────────────────────────────────────────────────────────────────────────────

describe("0101/#1401 — the pure showrunner heuristic", () => {
  const sig = (threadId: string, tension: number, staleness: number, salience: number): ThreadSignal =>
    ({ threadId, tension, staleness, salience });

  it("scores higher for more tension / more staleness / more board salience (bounded to [0,1])", () => {
    expect(scoreThread(sig("t", 0, 0, 0))).toBe(0);
    expect(scoreThread(sig("t", 1, 1, 1))).toBeLessThanOrEqual(1);
    expect(scoreThread(sig("t", 1, 0, 0))).toBeGreaterThan(scoreThread(sig("t", 0.2, 0, 0)));
    expect(scoreThread(sig("t", 0, 1, 0))).toBeGreaterThan(scoreThread(sig("t", 0, 0.2, 0)));
    // tension is weighted heaviest — a purely-tense thread outranks a purely-stale one at the same level.
    expect(scoreThread(sig("t", 1, 0, 0))).toBeGreaterThan(scoreThread(sig("t", 0, 1, 0)));
  });

  it("ranks the shortlist by score desc, emphasizes only the top-K, and the rest sit at baseline", () => {
    const signals = [
      sig("thread:low", 0.05, 0, 0),
      sig("thread:hot", 1, 1, 1),
      sig("thread:mid", 0.5, 0.2, 0),
      sig("thread:cool", 0.1, 0.1, 0),
      sig("thread:warm", 0.4, 0.5, 1),
    ];
    const note = composeShowrunnerNote(signals, 3, "nominations", 1);
    expect(note.emphases.length).toBe(SHOWRUNNER.emphasisSlots); // top-K only (K=3 here)
    // The hottest thread ranks first and carries the highest emphasis.
    expect(note.emphases[0]!.threadId).toBe("thread:hot");
    for (let i = 1; i < note.emphases.length; i++) {
      expect(note.emphases[i - 1]!.emphasis).toBeGreaterThanOrEqual(note.emphases[i]!.emphasis);
    }
    // Every emphasis is a BOUNDED, boost-only multiplier in [minEmphasis, maxEmphasis].
    for (const e of note.emphases) {
      expect(e.emphasis).toBeGreaterThanOrEqual(SHOWRUNNER.minEmphasis);
      expect(e.emphasis).toBeLessThanOrEqual(SHOWRUNNER.maxEmphasis);
    }
    // A thread NOT on the shortlist (and any thread when the note is absent) reads as exactly baseline.
    expect(emphasisForThread(note, "thread:low")).toBe(SHOWRUNNER.minEmphasis);
    expect(emphasisForThread(note, "thread:hot")).toBe(note.emphases[0]!.emphasis);
    expect(emphasisForThread(undefined, "thread:hot")).toBe(SHOWRUNNER.minEmphasis);
  });

  it("is a PURE function — same signals ⇒ byte-identical note (determinism, no rng)", () => {
    const signals = [sig("a", 0.3, 0.4, 0), sig("b", 0.9, 0.1, 1), sig("c", 0.2, 0.8, 0)];
    expect(JSON.stringify(composeShowrunnerNote(signals, 2, "veto", 5)))
      .toBe(JSON.stringify(composeShowrunnerNote(signals, 2, "veto", 5)));
    // Ties on score break by thread id (stable), never insertion order.
    const tied = [sig("z", 0.5, 0.5, 0.5), sig("a", 0.5, 0.5, 0.5)];
    const note = composeShowrunnerNote(tied, 1, "x", 1);
    expect(note.emphases.map((e) => e.threadId)).toEqual(["a", "z"]);
  });

  it("makes an OUTCOME DIRECTIVE inexpressible — an emphasis carries ONLY {threadId, emphasis, rationale}", () => {
    const note = composeShowrunnerNote([sig("t", 1, 1, 1)], 1, "x", 1);
    // The schema has no `surface`/`evict`/`winner`/`outcome` field — it can only re-weight, never decide.
    expect(Object.keys(note.emphases[0]!).sort()).toEqual(["emphasis", "rationale", "threadId"]);
    expect(note.emphases[0]!.rationale.length).toBeGreaterThan(0);
  });

  it("renders a Vault-SAFE retrospective line — the source NAME + rationale, never a premise or number", () => {
    const note = composeShowrunnerNote([sig("thread:npc:9:0", 0.9, 0.7, 1)], 4, "nominations", 2);
    const prose = showrunnerNoteToProse(note, () => "A Houseguest");
    expect(prose).toContain("A Houseguest");
    expect(prose).toContain("Week 4");
    // No raw emphasis multiplier / any float leaks into the bible prose (qualitative only).
    expect(prose).not.toMatch(/\d\.\d/);
    // No raw thread id / machine slug crosses.
    expect(prose).not.toContain("thread:npc:9:0");
  });
});

// ── the DoD behavioral claim: an emphasized SURFACED storyline reaches the player (fold-free) ─────────

/** Reach the scheduler internals to arm threads + drive `surfaceThread` (white-box, focused — the 0060
 *  test's `captureSurfacedBelief` pattern). The showrunner NEVER re-orders / re-rolls the scheduler's
 *  fold-producing transitions (that would perturb the closed set — proven byte-identical in
 *  `showrunnerOutcomeNeutral`); its ONLY effect is that an EMPHASIZED thread which surfaces NPC-only ALSO
 *  reaches the player — an additive, fold-free open-set belief. */
type Internals = {
  storyThreads: StoryThread[];
  seasonPosition: () => SeasonPosition;
  surfaceThread: (t: StoryThread, p: SeasonPosition, rng: SeededRandom) => void;
  rel: { edge: (a: EntityId, b: EntityId) => { trust: number; affinity: number; threat: number } };
};
const peek = (sb: UserSandbox): Internals => sb.session as unknown as Internals;

function freshGame(seed: number, user: string): UserSandbox {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed });
  return sb;
}

/** An rng that routes `surfaceThread` NPC-only (its first `next()` ≥ surfaceToPlayerProb) and is otherwise
 *  deterministic — so we exercise the "would have been NPC-only" case where the additive player-reach shows. */
function gossipRng(): SeededRandom {
  const r = new SeededRandom(1);
  (r as unknown as { next: () => number }).next = () => 0.99; // ≥ surfaceToPlayerProb ⇒ the NPC branch
  return r;
}

describe("0101/#1401 — an EMPHASIZED surfaced storyline reaches the player (the DoD behavioral claim)", () => {
  it("ON: an emphasized thread that surfaces NPC-only ALSO reaches the player; the NPC gossip is unchanged", () => {
    const sb = freshGame(7, "sr-reach");
    const internals = peek(sb);
    let npcGossiped = false;
    let reachedPlayer = false;
    sb.session.setOnThreadGossip(() => { npcGossiped = true; });
    sb.session.setOnThreadSurfaceToPlayer(() => { reachedPlayer = true; return true; });

    // Make exactly ONE source hot (maximal player tension) so the showrunner emphasizes its threads; all
    // others cold. Arm every thread `active` so `surfaceThread` is a legal call for any of them.
    const hotSource = internals.storyThreads[0]!.sourceId;
    const week = sb.session.snapshot().week;
    for (const t of internals.storyThreads) {
      const hot = t.sourceId === hotSource;
      for (const [a, b] of [[PLAYER, t.sourceId], [t.sourceId, PLAYER]] as const) {
        const e = internals.rel.edge(a, b); e.threat = hot ? 1 : 0; e.affinity = 0; e.trust = 0;
      }
      t.status = "active"; t.lifecycleWeek = week;
    }
    const hotThreads = internals.storyThreads.filter((t) => t.sourceId === hotSource);
    const coldThread = internals.storyThreads.find((t) => t.sourceId !== hotSource)!;

    // OFF: a hot thread surfaces NPC-only — the player does NOT catch it (baseline 0060 behavior).
    sb.session.setShowrunnerEnabled(false);
    internals.surfaceThread({ ...hotThreads[0]!, status: "active" }, internals.seasonPosition(), gossipRng());
    expect(npcGossiped, "the NPC↔NPC gossip fires").toBe(true);
    expect(reachedPlayer, "OFF: an NPC-only surfacing does not reach the player").toBe(false);

    // ON: compose the note (the hot source's threads are emphasized), then surface the hot source's threads
    // NPC-only. The NPC gossip STILL fires (byte-identical) AND the player now ALSO catches the emphasized
    // storyline — the producer's one effect. (Surface each hot thread; at least the top-K reach the player.)
    sb.session.setShowrunnerEnabled(true);
    sb.session.showrunnerTick();
    let hotReachedPlayer = 0;
    for (const t of hotThreads) {
      npcGossiped = false; reachedPlayer = false;
      internals.surfaceThread({ ...t, status: "active" }, internals.seasonPosition(), gossipRng());
      expect(npcGossiped, "the NPC gossip is unchanged with the showrunner ON").toBe(true);
      if (reachedPlayer) hotReachedPlayer++;
    }
    expect(hotReachedPlayer, "an emphasized storyline reaches the player").toBeGreaterThan(0);

    // A NON-emphasized (cold source) thread stays NPC-only even with the showrunner ON.
    npcGossiped = false; reachedPlayer = false;
    internals.surfaceThread({ ...coldThread, status: "active" }, internals.seasonPosition(), gossipRng());
    expect(npcGossiped).toBe(true);
    expect(reachedPlayer, "an un-emphasized storyline is not routed to the player").toBe(false);
  });

  it("OFF (no note): surfacing is exactly the baseline 0060 behavior — no additive player reach", () => {
    const sb = freshGame(9, "sr-reach-off");
    const internals = peek(sb);
    let reachedPlayer = false;
    sb.session.setOnThreadGossip(() => { /* npc-only */ });
    sb.session.setOnThreadSurfaceToPlayer(() => { reachedPlayer = true; return true; });
    const week = sb.session.snapshot().week;
    for (const t of internals.storyThreads) {
      for (const [a, b] of [[PLAYER, t.sourceId], [t.sourceId, PLAYER]] as const) {
        const e = internals.rel.edge(a, b); e.threat = 1; e.affinity = 0; e.trust = 0; // maximal tension everywhere
      }
      t.status = "active"; t.lifecycleWeek = week;
    }
    // Even with maximal tension, the showrunner OFF ⇒ no note ⇒ no additive player reach on an NPC-only surface.
    internals.surfaceThread({ ...internals.storyThreads[0]!, status: "active" }, internals.seasonPosition(), gossipRng());
    expect(reachedPlayer).toBe(false);
  });
});

// ── the B59 constants gate (every magnitude lives in showrunnerConstants) ────────────────────────────

describe("0101/#1401 — the constants grep gate (B59) covers showrunnerConstants", () => {
  it("the showrunner's magnitudes live ONLY in showrunnerConstants, never inlined at a call site", () => {
    const adapter = readFileSync("src/adapters/engine/GameSessionAdapter.ts", "utf8");
    const engine = readFileSync("src/engine/showrunner.ts", "utf8");
    expect(adapter).toContain("SHOWRUNNER.");
    expect(engine).toContain("showrunnerConstants");
    // No inlined emphasis band / weights at a call site.
    expect(adapter).not.toMatch(/maxEmphasis\s*[=:]\s*1\.6/);
    expect(engine).not.toMatch(/emphasisSlots\s*[=:]\s*3\b/); // the value lives in the constants module only
    // The band is bounded + boost-only (never suppresses below baseline; never an unbounded firehose).
    expect(SHOWRUNNER.minEmphasis).toBe(1.0);
    expect(SHOWRUNNER.maxEmphasis).toBeGreaterThan(1.0);
    expect(SHOWRUNNER.maxEmphasis).toBeLessThanOrEqual(2.0);
  });
});
