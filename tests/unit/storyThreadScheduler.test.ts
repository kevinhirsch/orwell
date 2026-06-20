import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { PLAYER } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  deriveStoryThreads, defaultTriggerConditionFor, triggerMet, sourceWindowClosed, threadRumor,
  generateDeepProfile, TRIGGER_CONDITIONS, STORY_THREAD_KIND,
  type SeasonPosition, type StoryThread,
} from "../../src/engine/deepProfile";
import { THREAD } from "../../src/engine/threadConstants";
import type { UserSandbox } from "../../src/composition/registry";

/**
 * Feature 0060 — the story-thread trigger/resolution scheduler. The seeded, sealed threads PLAY OUT,
 * driven by a small, seeded, bounded scheduler that rides the EXISTING off-screen tick. HARD rule:
 * roles only, no names. It authors nothing — activation reuses the 0023 fold, surfacing reuses 0038 +
 * 0002. Restraint is structural (a hard season cap; NPC↔NPC surfacing dominates; what reaches the
 * player is a belief, never a premise/number).
 */

/** Drive a live-loop beat + resolve any pending decision (deterministic). */
function stepLoop(sb: UserSandbox): boolean {
  const adv = sb.session.advanceGame();
  if (adv.pending) {
    const p = adv.pending;
    if (p.kind === "nominations") sb.session.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
    else if (p.kind === "veto-decision") sb.session.submitDecision({ kind: "veto-decision", use: false });
    else if (p.kind === "replacement") sb.session.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
    else if (p.kind === "finale-statement") sb.session.submitDecision({ kind: "finale-statement", statement: "x" });
    else if (p.kind === "finale-answer") sb.session.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
    else if (p.kind === "juror-vote") sb.session.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
    else sb.session.submitDecision({ kind: p.kind, vote: p.options[0]!.id } as never);
  }
  return adv.finished;
}

// Playing a full season is the expensive step; the result is seed-deterministic, so memoize by seed
// (under the SAME user key, so the orchestrator's per-user rng stream is stable). A cached sandbox is
// read-only in the assertions below (snapshot reads + relationship reads), so reuse is safe.
// A bounded multi-week sim (NOT to the finale): ~SIM_WEEKS_TICKS off-screen ticks is enough for the
// whole thread lifecycle to play out (activate → surface to the cap → resolve → expire), while keeping
// the per-season event/memory footprint small enough that the parallel unit lane never OOMs (the hard
// lesson: playing every assertion to the full finale, in several files at once, exceeds the runner's
// memory). The scheduler's drama is front-loaded; by here it has fully exercised every transition.
const SIM_TICKS = 130;
function freshSeason(seed: number): UserSandbox {
  const reg = new GameSessionRegistry();
  const user = "sts";
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  const orch = new Orchestrator(reg, new FakeClock(), { seed });
  let finished = false;
  for (let i = 0; i < SIM_TICKS; i++) {
    if (!finished) finished = stepLoop(sb); // keep advancing the live loop until it ends…
    if (finished) break;                    // …then stop (no point ticking an over game — and no noise)
    orch.advance(user, "offscreen-tick");   // the off-screen tick the scheduler rides
  }
  return sb;
}
/**
 * A LIGHTWEIGHT, seed-deterministic summary of a played season — only the small facts the read-only
 * assertions need. Crucially it does NOT retain the full sandbox (events/souls/knowledge for a whole
 * season), so the test holds bounded memory even across several seeds (the OOM lesson: a memoized full
 * sandbox per seed accumulates and tips the parallel unit lane over its memory limit).
 */
interface SeasonSummary {
  statuses: string[];                 // `${id}:${status}` for every thread (sorted)
  threadCount: number;
  surfaced: number;
  surfacedCounter: number;
  resolved: number;
  neverSurfaced: number;
  everActive: number;
  terminal: number;
  foldedAWeight: boolean;             // at least one activated thread moved the player's read off baseline
  npcBeliefs: number;                 // NPC↔NPC thread-gloss beliefs (over every NPC id)
  playerBeliefs: number;              // thread-gloss beliefs that reached the player
  names: string;                      // the public static cast (byte-stability check)
  sealedThreadRecords: number;        // Vault STORY_THREAD_KIND records
}

const GLOSS = /feeling around the house|carrying something|blind spot|bigger game/;

function summarize(seed: number): SeasonSummary {
  const sb = freshSeason(seed);
  const threads = threadsOf(sb);
  const rel = sb.engine.relationships;
  const npcs = sb.session.snapshot().house?.npcs ?? [];
  let npcBeliefs = 0;
  for (const n of npcs) npcBeliefs += sb.engine.knowledge.knownTo(n.id).filter((k) => GLOSS.test(k.content)).length;
  const summary: SeasonSummary = {
    statuses: threads.map((t) => `${t.id}:${t.status}`).sort(),
    threadCount: threads.length,
    surfaced: threads.filter((t) => t.status === "surfaced").length,
    surfacedCounter: sb.session.snapshot().surfacedThreadCount ?? 0,
    resolved: threads.filter((t) => t.status === "resolved").length,
    neverSurfaced: threads.filter((t) => t.status !== "surfaced").length,
    everActive: threads.filter((t) => ["active", "surfaced", "resolved"].includes(t.status)).length,
    terminal: threads.filter((t) => ["resolved", "expired"].includes(t.status)).length,
    foldedAWeight: threads
      .filter((t) => ["active", "surfaced", "resolved"].includes(t.status))
      .some((t) => {
        const e = rel.edge(PLAYER, t.sourceId);
        return Math.abs(e.trust - 0.25) > 1e-6 || Math.abs(e.affinity - 0.25) > 1e-6 || Math.abs(e.threat - 0.1) > 1e-6;
      }),
    npcBeliefs,
    playerBeliefs: sb.engine.knowledge.knownTo(PLAYER).filter((k) => GLOSS.test(k.content)).length,
    names: sb.session.getGameState().house.map((h) => h.name).join(","),
    sealedThreadRecords: sb.engine.vault.readHidden({ kind: STORY_THREAD_KIND }).length,
  };
  return summary; // the sandbox is now unreferenced and GC-eligible
}

function threadsOf(sb: UserSandbox): StoryThread[] {
  return sb.session.snapshot().storyThreads ?? [];
}

describe("0060 — structured triggers (the §3 closed enum)", () => {
  it("every derived thread carries a structured trigger condition from the closed set", () => {
    const profile = generateDeepProfile(new SeededRandom(7));
    const threads = deriveStoryThreads(new SeededRandom(7), "npc:1", profile);
    expect(threads.length).toBeGreaterThan(0);
    for (const t of threads) {
      expect(t.triggerCondition).toBeDefined();
      expect(TRIGGER_CONDITIONS).toContain(t.triggerCondition!);
      expect(t.lifecycleWeek).toBe(0);
      // The prose trigger stays for recall/flavor (0058 §6) — never dropped.
      expect(t.trigger.length).toBeGreaterThan(0);
    }
  });

  it("the condition is mapped by source class and is seed-stable", () => {
    const a = deriveStoryThreads(new SeededRandom(3), "npc:2", generateDeepProfile(new SeededRandom(3)));
    const b = deriveStoryThreads(new SeededRandom(3), "npc:2", generateDeepProfile(new SeededRandom(3)));
    expect(a.map((t) => t.triggerCondition)).toEqual(b.map((t) => t.triggerCondition));
    // The weakness thread maps to a weakness-class condition; the goal thread to a goal-class one.
    const weakness = a.find((t) => t.premise.startsWith("weakness"));
    const goal = a.find((t) => t.premise.startsWith("true goal"));
    expect(["cornered-socially", "goal-demands-move"]).toContain(weakness!.triggerCondition);
    expect(["house-tightens", "goal-demands-move"]).toContain(goal!.triggerCondition);
  });

  it("the default condition for a fieldless (pre-0060) thread is inferred by premise class", () => {
    expect(defaultTriggerConditionFor({ premise: "secret — something" })).toBe("on-block");
    expect(defaultTriggerConditionFor({ premise: "weakness — a blind spot" })).toBe("cornered-socially");
    expect(defaultTriggerConditionFor({ premise: "true goal — win quietly" })).toBe("house-tightens");
  });

  it("triggerMet reads only Vault-free position facts (a gate, never a content channel)", () => {
    const t: StoryThread = {
      id: "thread:npc:1:0", sourceId: "npc:1", premise: "secret — x", trigger: "p",
      triggerCondition: "on-block", surfacingPathways: ["overheard"], weightImpact: "conflict",
      status: "dormant", lifecycleWeek: 0,
    };
    const base: SeasonPosition = {
      week: 3, livingCount: 12, nominees: new Set(), powerHolders: new Set(),
      cornered: new Set(), nominatedRepeatedly: new Set(), evicted: new Set(),
    };
    expect(triggerMet(t, base)).toBe(false);
    expect(triggerMet(t, { ...base, nominees: new Set(["npc:1"]) })).toBe(true);
    expect(triggerMet({ ...t, triggerCondition: "house-tightens" }, base)).toBe(false);
    expect(triggerMet({ ...t, triggerCondition: "house-tightens" }, { ...base, livingCount: THREAD.tightenCastSize })).toBe(true);
    expect(triggerMet({ ...t, triggerCondition: "goal-demands-move" }, { ...base, powerHolders: new Set(["npc:1"]) })).toBe(true);
    expect(sourceWindowClosed(t, { ...base, evicted: new Set(["npc:1"]) })).toBe(true);
  });
});

describe("0060 — the paraphrase is Vault-safe (§4.2 / §7)", () => {
  it("threadRumor never includes the premise/trigger — only a class-keyed atmospheric gloss", () => {
    const t: StoryThread = {
      id: "thread:npc:1:0", sourceId: "npc:1",
      premise: "secret — is in real financial trouble — the prize money is urgent",
      trigger: "activates when this houseguest is genuinely threatened on the block",
      triggerCondition: "on-block", surfacingPathways: ["overheard"], weightImpact: "conflict",
      status: "active", lifecycleWeek: 1,
    };
    const rumor = threadRumor(t, "Houseguest");
    expect(rumor).not.toContain("financial");
    expect(rumor).not.toContain("prize money");
    expect(rumor).not.toContain("threatened on the block");
    expect(rumor).toContain("Houseguest"); // a public name is a public fact
    expect(rumor.length).toBeGreaterThan(10);
  });
});

// The integration-level assertions read lightweight SUMMARIES of two seeded seasons (7, 11) — built
// ONCE here, the full sandboxes discarded immediately (the OOM lesson: holding full season sandboxes in
// the parallel unit lane tips it over its memory limit). Plays-out coverage + the season cap + NPC
// dominance + per-seed divergence + determinism are all asserted over these summaries.
describe("0060 — plays out over seeded multi-week sims (§10a/b/e, §4.5, §5)", () => {
  const s7 = summarize(7);
  const s11 = summarize(11);
  const s7b = summarize(7); // an INDEPENDENT replay at the same seed — the determinism proof

  it("a measurable share activate AND reach a terminal status, and activations folded a hidden weight", () => {
    for (const s of [s7, s11]) {
      expect(s.threadCount).toBeGreaterThan(10);
      expect(s.everActive).toBeGreaterThanOrEqual(3);
      expect(s.terminal).toBeGreaterThanOrEqual(3);
      expect(s.foldedAWeight).toBe(true);
    }
  });

  it("the hard season surfacing cap holds and surplus ripe threads still resolve off-screen (§5)", () => {
    for (const s of [s7, s11]) {
      expect(s.surfaced).toBeLessThanOrEqual(THREAD.maxSurfacedPerSeason);
      expect(s.surfacedCounter).toBeLessThanOrEqual(THREAD.maxSurfacedPerSeason);
      expect(s.resolved).toBeGreaterThan(0);     // surplus still played out off-screen
      expect(s.neverSurfaced).toBeGreaterThan(0); // some never surface (the L40 restraint)
    }
  });

  it("NPC↔NPC surfacing dominates surfacing to the player (§5.2)", () => {
    expect(s7.npcBeliefs + s11.npcBeliefs).toBeGreaterThanOrEqual(s7.playerBeliefs + s11.playerBeliefs);
  });

  it("two seeds diverge in WHICH threads play out (§10b)", () => {
    const live = (s: SeasonSummary): string => s.statuses.filter((x) => !x.endsWith(":dormant")).join(",");
    expect(live(s7)).not.toBe(live(s11));
  });

  it("the threads are sealed into the Vault as story-thread records (§7 / non-degradation)", () => {
    expect(s7.sealedThreadRecords).toBeGreaterThan(0);
  });

  it("same seed ⇒ identical thread drama AND a byte-stable static cast (§4.5)", () => {
    expect(s7b.statuses.join(",")).toBe(s7.statuses.join(",")); // identical transitions
    expect(s7b.names).toBe(s7.names);                            // the scheduler never perturbed the cast
  });
});

describe("0060 — persistence (§10d): the lifecycle survives a restart", () => {
  it("statuses round-trip, expired threads are retained, the cap counter persists, pre-0060 loads clean", () => {
    const sb = freshSeason(11); // mutates (restore) — its own season, never the shared cache
    const before = threadsOf(sb).map((t) => `${t.id}:${t.status}`).sort();
    expect(before.some((s) => s.endsWith(":expired") || s.endsWith(":resolved") || s.endsWith(":surfaced"))).toBe(true);
    const core = sb.session.snapshot();
    sb.session.restore(core);
    expect(threadsOf(sb).map((t) => `${t.id}:${t.status}`).sort()).toEqual(before); // none deleted (§7)
    expect(sb.session.snapshot().surfacedThreadCount).toBe(core.surfacedThreadCount); // cap not re-opened

    // Pre-0060 back-compat: strip the structured fields off the persisted threads → loads clean + defaults.
    const legacy = sb.session.snapshot();
    for (const t of legacy.storyThreads ?? []) {
      delete (t as Partial<StoryThread>).triggerCondition;
      delete (t as Partial<StoryThread>).lifecycleWeek;
    }
    delete (legacy as { nominationWeeks?: unknown }).nominationWeeks;
    delete (legacy as { surfacedThreadCount?: unknown }).surfacedThreadCount;
    expect(() => sb.session.restore(legacy)).not.toThrow();
    for (const t of threadsOf(sb)) {
      expect(t.triggerCondition).toBeDefined();
      expect(t.lifecycleWeek).toBeDefined();
    }
  });

  it("an in-flight active thread round-trips still active mid-season", () => {
    const reg = new GameSessionRegistry();
    const user = "stmid";
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed: 7 });
    const orch = new Orchestrator(reg, new FakeClock(), { seed: 7 });
    let active: string[] = [];
    for (let i = 0; i < 300; i++) {
      const finished = stepLoop(sb);
      orch.advance(user, "offscreen-tick");
      active = threadsOf(sb).filter((t) => t.status === "active").map((t) => t.id);
      if (active.length > 0) break; // stop at the FIRST activation — a cheap partial sim, not a full season
      if (finished) break;
    }
    expect(active.length).toBeGreaterThan(0);
    const core = sb.session.snapshot();
    sb.session.restore(core);
    expect(threadsOf(sb).filter((t) => t.status === "active").map((t) => t.id).sort()).toEqual([...active].sort());
  });
});

describe("0060 — the no-leak sentinel holds even AFTER surfacing (§7 / §10c)", () => {
  it("no thread premise/trigger/condition reaches any player or admin surface, surfaced or not", () => {
    const reg = new GameSessionRegistry();
    const user = "stleak";
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed: 7 });
    // Plant a sentinel into every thread premise/trigger via snapshot→restore (the 0058 plant pattern).
    const SENT = "SENTINEL-0060-unit";
    const core = sb.session.snapshot();
    for (const t of core.storyThreads ?? []) {
      t.premise = `${t.premise} ${SENT}`;
      t.trigger = `${t.trigger} ${SENT}`;
    }
    sb.session.restore(core);
    const orch = new Orchestrator(reg, new FakeClock(), { seed: 7 });
    let finished = false;
    for (let i = 0; i < SIM_TICKS; i++) {
      if (!finished) finished = stepLoop(sb);
      if (finished) break;
      orch.advance(user, "offscreen-tick");
    }
    // After a multi-week sim WITH surfacing, no outward surface carries the sentinel.
    const surface = JSON.stringify(sb.session.getGameState())
      + JSON.stringify(sb.player.getVisibleState())
      + JSON.stringify(sb.session.getMomentPrompt({}))
      + sb.session.getGameState().house.filter((h) => h.status === "active").map((h) => JSON.stringify(sb.session.npcVoice(h.id))).join("");
    expect(surface.includes(SENT)).toBe(false);
    sb.syncAdmin?.();
    expect(JSON.stringify(sb.admin.inspect()).includes(SENT)).toBe(false);
  });
});

describe("0060 — the constants grep gate (B59) covers threadConstants", () => {
  it("the scheduler's magnitudes live ONLY in threadConstants, never inlined at a call site", () => {
    const adapter = readFileSync("src/adapters/engine/GameSessionAdapter.ts", "utf8");
    const orch = readFileSync("src/composition/orchestrator.ts", "utf8");
    expect(adapter).toContain("threadConstants");
    expect(adapter).toContain("THREAD.");
    expect(adapter).not.toMatch(/maxSurfacedPerSeason\s*[=:]\s*4\b/);
    expect(adapter).not.toMatch(/surfaceProb\s*[=:]\s*0\.15/);
    expect(orch).toContain("scheduleStoryThreads"); // the orchestrator only CALLS the scheduler
    expect(THREAD.maxSurfacedPerSeason).toBeGreaterThan(0);
    expect(THREAD.maxSurfacedPerSeason).toBeLessThanOrEqual(4); // range guidance 3–4
  });
});
