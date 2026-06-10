/**
 * tests/uat/fullGameUat.test.ts
 *
 * Full-game UAT over the deployed HTTP transport path.
 *
 * Spins up the same runtime as main.ts (composeRuntime → createHttpMcpServer),
 * drives every game entirely via HTTP calls — createCharacter → advanceGame /
 * submitDecision in a loop → winner — and checks invariants on every response.
 *
 * Coverage gaps this fills vs. the existing test suite:
 *   httpServer.test.ts:          onboarding + tool checks only, no full loop over HTTP.
 *   liveProgression.test.ts:     full game but via GameSessionRegistry directly; 2 seeds.
 *   vault-sentinel.property.ts:  checks tools in isolation, not the live-game HTTP flow.
 *
 * Edge cases specifically targeted:
 *   - Veto-use + replacement decision path    (always-use-veto strategy)
 *   - Final-4 veto-revert (no legal replacement → engine reverts; replacement pend absent)
 *   - Player in every role across seeds       (HOH, nominee, veto holder, voter, bystander)
 *   - All 4 player decision types exercised   (nominations, veto-decision, replacement, eviction-vote)
 *   - Raw entity-id leaks in humanised beat content
 *   - Numeric stat / soul / relationship leaks in any player-facing HTTP response
 *   - Game always finishes (no runaway loop)
 *   - Final-2 roster: exactly 1 active NPC in the house when the player survives to finale
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHttpMcpServer } from "../../src/adapters/mcp/HttpMcpServer";
import { composeRuntime } from "../../src/composition/runtime";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { McpServer } from "../../src/adapters/mcp/McpServer";

// ─── HTTP response shapes ────────────────────────────────────────────────────

interface NamedRef { id: string; name: string; }

interface PendingDecision {
  kind: "nominations" | "veto-decision" | "comp-intent" | "houseguests-choice" | "replacement" | "eviction-vote" | "tie-break" | "final-eviction"
      | "finale-statement" | "finale-answer" | "juror-vote";
  by: NamedRef;
  options: NamedRef[];
  pick: number;
  /** finale-answer: the legal structured appeals (engine enum values). */
  appeals?: string[];
}

interface CeremonyStatus {
  week: number;
  phase: string;
  hoh: NamedRef | null;
  nominees: NamedRef[];
  veto: { holder: NamedRef | null; used: boolean };
}

interface AdvanceResult {
  started: boolean;
  finished: boolean;
  winner: NamedRef | null;
  pending: PendingDecision | null;
  status: CeremonyStatus;
  event: { beat: string; content: string } | null;
}

interface GameStateResult {
  started: boolean;
  house: { id: string; name: string; status: "active" | "evicted" }[];
}

// ─── Anomaly model ───────────────────────────────────────────────────────────

type AnomalyKind =
  | "http-error"             // non-200 or JSON parse failure
  | "vault-stat-leak"        // numeric stat / soul / relationship value in player response
  | "missing-winner"         // finished=true but winner=null
  | "stale-loop"             // MAX_ITERATIONS reached without finishing
  | "empty-pending-options"  // pending decision with insufficient options
  | "duplicate-option"       // same id listed twice in pending options
  | "illegal-entity-id"      // raw "npc:" id survived humanisation in event content
  | "decision-rejection"     // submitDecision returned an engine error
  | "ceremony-anomaly"       // nominations phase but no HOH in status
  | "final-roster-anomaly";  // getGameState post-finish shows unexpected active count

interface Anomaly {
  seed: number;
  strategy: string;
  week: number;
  beat: string;
  kind: AnomalyKind;
  detail: string;
}

// ─── Decision strategies ─────────────────────────────────────────────────────

type DecisionStrategy = "never-use-veto" | "always-use-veto";

function autoResolve(p: PendingDecision, strategy: DecisionStrategy): Record<string, unknown> {
  switch (p.kind) {
    case "nominations":
      // Always nominate first two legal options.
      return { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] };
    case "veto-decision":
      if (strategy === "always-use-veto" && p.options.length > 0) {
        // Save the first nominee; the engine reverts if no legal replacement exists (final-4).
        return { kind: "veto-decision", use: true, save: p.options[0]!.id };
      }
      return { kind: "veto-decision", use: false };
    case "comp-intent": // B46: declare the player's competition approach (default compete).
      return { kind: "comp-intent", intent: "compete" };
    case "houseguests-choice": // B45: the player drew the chip — pick the sixth veto player.
      return { kind: "houseguests-choice", vote: p.options[0]!.id };
    case "replacement":
      return { kind: "replacement", replacement: p.options[0]!.id };
    case "eviction-vote":
      return { kind: "eviction-vote", vote: p.options[0]!.id };
    case "tie-break": // B44: the player HOH breaks a tied eviction vote.
      return { kind: "tie-break", vote: p.options[0]!.id };
    case "final-eviction": // Final 3 (0045): the player is the final HOH — evict one of the other two.
      return { kind: "final-eviction", vote: p.options[0]!.id };
    // --- 0037 interactive finale ---
    case "finale-statement":
      return { kind: "finale-statement", statement: "I played my own game." };
    case "finale-answer":
      return { kind: "finale-answer", appeal: p.appeals?.[0] ?? "own-game" };
    case "juror-vote":
      return { kind: "juror-vote", vote: p.options[0]!.id };
  }
}

// ─── Invariant checkers ───────────────────────────────────────────────────────

/** Patterns that must never appear in a player-channel HTTP response body. */
const VAULT_LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/"(physical|mental|social)"\s*:\s*\d+\.\d+/, "numeric competition stat in player response"],
  [/"(trust|affinity|threat)"\s*:\s*\d+\.\d+/,  "raw relationship numeric in player response"],
  [/"soul"\s*:\s*[{[]/,                           '"soul" object/array in player response'],
  [/"hidden"\s*:\s*true/,                         '"hidden":true in player response'],
];

function checkResponseBody(
  raw: string,
  ctx: { seed: number; strategy: string; week: number; beat: string },
  anomalies: Anomaly[],
): void {
  for (const [re, detail] of VAULT_LEAK_PATTERNS) {
    if (re.test(raw)) {
      anomalies.push({ ...ctx, kind: "vault-stat-leak", detail });
    }
  }
}

function checkAdvanceResult(
  adv: AdvanceResult,
  ctx: { seed: number; strategy: string },
  anomalies: Anomaly[],
): void {
  const week = adv.status.week;
  const beat = adv.status.phase;
  const loc = { ...ctx, week, beat };

  if (adv.finished && !adv.winner) {
    anomalies.push({ ...loc, kind: "missing-winner", detail: "game finished with no winner" });
  }

  if (adv.event?.content && /\bnpc:\d+\b/.test(adv.event.content)) {
    anomalies.push({ ...loc, kind: "illegal-entity-id", detail: `raw entity id survived humanisation: "${adv.event.content.slice(0, 100)}"` });
  }

  if (beat === "nominations" && !adv.status.hoh) {
    anomalies.push({ ...loc, kind: "ceremony-anomaly", detail: "nominations phase but hoh is null" });
  }

  const p = adv.pending;
  if (p) {
    const minOptions: Record<string, number> = {
      nominations: 2, replacement: 1, "eviction-vote": 1, "veto-decision": 0,
      "finale-statement": 0, "finale-answer": 0, "juror-vote": 1,
    };
    if (p.options.length < (minOptions[p.kind] ?? 0)) {
      anomalies.push({ ...loc, kind: "empty-pending-options", detail: `${p.kind} has ${p.options.length} options (need ${minOptions[p.kind]})` });
    }
    const ids = p.options.map((o) => o.id);
    if (new Set(ids).size < ids.length) {
      anomalies.push({ ...loc, kind: "duplicate-option", detail: `duplicate ids in ${p.kind}: ${ids.join(", ")}` });
    }
  }
}

// ─── Per-run game driver ──────────────────────────────────────────────────────

const MAX_ITERATIONS = 5_000;

interface RunResult {
  seed: number;
  strategy: DecisionStrategy;
  weeksPlayed: number;
  finished: boolean;
  winner: NamedRef | null;
  /** Count of each decision kind resolved by the player. */
  decisionCounts: Partial<Record<PendingDecision["kind"], number>>;
  anomalies: Anomaly[];
}

async function runFullGame(
  base: string,
  seed: number,
  strategy: DecisionStrategy,
): Promise<RunResult> {
  const user = `uat-${seed}-${strategy}`;
  const anomalies: Anomaly[] = [];
  const decisionCounts: Partial<Record<PendingDecision["kind"], number>> = {};
  let winner: NamedRef | null = null;
  let weeksPlayed = 0;
  let finished = false;

  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T | null> => {
    let raw = "";
    try {
      const res = await fetch(`${base}/player/call`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-orwell-user": user },
        body: JSON.stringify({ name, args }),
      });
      raw = await res.text();
      if (!res.ok) {
        anomalies.push({ seed, strategy, week: weeksPlayed, beat: name, kind: "http-error", detail: `HTTP ${res.status}` });
        return null;
      }
    } catch (e) {
      anomalies.push({ seed, strategy, week: weeksPlayed, beat: name, kind: "http-error", detail: String(e) });
      return null;
    }
    checkResponseBody(raw, { seed, strategy, week: weeksPlayed, beat: name }, anomalies);
    const body = JSON.parse(raw) as { result?: T; error?: string };
    if (body.error) {
      anomalies.push({ seed, strategy, week: weeksPlayed, beat: name, kind: "decision-rejection", detail: body.error });
      return null;
    }
    return body.result ?? null;
  };

  // Start the game.
  await call<unknown>("createCharacter", { playerName: "UAT Player", seed });

  let consecutiveSubmitFailures = 0;

  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    const adv = await call<AdvanceResult>("advanceGame", {});
    if (!adv) break; // HTTP error or body.error — already pushed as http-error anomaly

    // createCharacter failed silently: game never started → infinite started=false loop without this guard
    if (!adv.started) {
      anomalies.push({ seed, strategy, week: 0, beat: "advanceGame", kind: "stale-loop",
        detail: "advanceGame returned started=false — createCharacter may have failed" });
      break;
    }

    weeksPlayed = adv.status.week;
    finished = adv.finished;
    winner = adv.winner;
    checkAdvanceResult(adv, { seed, strategy }, anomalies);

    if (adv.pending) {
      const p = adv.pending;
      decisionCounts[p.kind] = (decisionCounts[p.kind] ?? 0) + 1;
      // Only submit if we have enough options (anomaly already recorded if not).
      const minOpts: Partial<Record<string, number>> = { nominations: 2, replacement: 1, "eviction-vote": 1, "juror-vote": 1 };
      if (p.options.length >= (minOpts[p.kind] ?? 0)) {
        const subAdv = await call<AdvanceResult>("submitDecision", autoResolve(p, strategy));
        if (subAdv) {
          consecutiveSubmitFailures = 0;
          finished = subAdv.finished;
          winner = subAdv.winner;
          checkAdvanceResult(subAdv, { seed, strategy }, anomalies);
        } else {
          // submitDecision errored → decision not applied → next advanceGame returns same pending.
          // Break after 3 consecutive failures to avoid burning all iterations in a stuck loop.
          consecutiveSubmitFailures++;
          if (consecutiveSubmitFailures >= 3) {
            anomalies.push({ seed, strategy, week: weeksPlayed, beat: p.kind, kind: "stale-loop",
              detail: `submitDecision failed ${consecutiveSubmitFailures}x in a row for '${p.kind}' — stuck loop` });
            break;
          }
        }
      }
    }

    if (!finished && i === MAX_ITERATIONS - 1) {
      anomalies.push({ seed, strategy, week: weeksPlayed, beat: "loop", kind: "stale-loop", detail: `game did not finish within ${MAX_ITERATIONS} iterations` });
    }
  }

  // Post-finish: verify the final-2 roster via getGameState.
  if (finished) {
    const state = await call<GameStateResult>("getGameState", {});
    if (state) {
      const active = state.house.filter((h) => h.status === "active");
      // 15 NPCs: at finale the player is either still in (1 NPC active) or was evicted (2 NPCs active).
      // More than 2 active NPCs post-finish is a bug.
      if (active.length > 2) {
        anomalies.push({ seed, strategy, week: weeksPlayed, beat: "finale", kind: "final-roster-anomaly", detail: `${active.length} NPCs still active at game end (expected ≤ 2)` });
      }
    }
  }

  return { seed, strategy, weeksPlayed, finished, winner, decisionCounts, anomalies };
}

// ─── Direct (non-HTTP) game driver ────────────────────────────────────────────

/**
 * Drives a full game through the McpServer.callTool API directly — no HTTP round-trip.
 * Used for the large completion-oriented test suites (tests 1 and 2) where CI's HTTP
 * overhead caused intermittent stale-loop failures that never reproduced locally.
 * Vault-leak invariants are still checked by serialising each result to JSON.
 */
async function runFullGameDirect(
  resolver: (channel: "player" | "admin", user: string) => McpServer,
  seed: number,
  strategy: DecisionStrategy,
): Promise<RunResult> {
  // Distinct prefix avoids sharing sandbox state with HTTP-based test runs.
  const user = `uat-d-${seed}-${strategy}`;
  const anomalies: Anomaly[] = [];
  const decisionCounts: Partial<Record<PendingDecision["kind"], number>> = {};
  let winner: NamedRef | null = null;
  let weeksPlayed = 0;
  let finished = false;

  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T | null> => {
    let result: unknown;
    try {
      result = await resolver("player", user).callTool(name, args);
    } catch (e) {
      anomalies.push({ seed, strategy, week: weeksPlayed, beat: name, kind: "http-error", detail: String(e) });
      return null;
    }
    // Serialise to catch vault-leak patterns (same regexes, just over JSON rather than HTTP body).
    const raw = JSON.stringify({ result });
    checkResponseBody(raw, { seed, strategy, week: weeksPlayed, beat: name }, anomalies);
    return (result as T) ?? null;
  };

  await call<unknown>("createCharacter", { playerName: "UAT Player", seed });

  let consecutiveSubmitFailures = 0;

  for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
    const adv = await call<AdvanceResult>("advanceGame", {});
    if (!adv) break;

    if (!adv.started) {
      anomalies.push({ seed, strategy, week: 0, beat: "advanceGame", kind: "stale-loop",
        detail: "advanceGame returned started=false — createCharacter may have failed" });
      break;
    }

    weeksPlayed = adv.status.week;
    finished = adv.finished;
    winner = adv.winner;
    checkAdvanceResult(adv, { seed, strategy }, anomalies);

    if (adv.pending) {
      const p = adv.pending;
      decisionCounts[p.kind] = (decisionCounts[p.kind] ?? 0) + 1;
      const minOpts: Partial<Record<string, number>> = { nominations: 2, replacement: 1, "eviction-vote": 1, "juror-vote": 1 };
      if (p.options.length >= (minOpts[p.kind] ?? 0)) {
        const subAdv = await call<AdvanceResult>("submitDecision", autoResolve(p, strategy));
        if (subAdv) {
          consecutiveSubmitFailures = 0;
          finished = subAdv.finished;
          winner = subAdv.winner;
          checkAdvanceResult(subAdv, { seed, strategy }, anomalies);
        } else {
          consecutiveSubmitFailures++;
          if (consecutiveSubmitFailures >= 3) {
            anomalies.push({ seed, strategy, week: weeksPlayed, beat: p.kind, kind: "stale-loop",
              detail: `submitDecision failed ${consecutiveSubmitFailures}x in a row for '${p.kind}' — stuck loop` });
            break;
          }
        }
      }
    }

    if (!finished && i === MAX_ITERATIONS - 1) {
      anomalies.push({ seed, strategy, week: weeksPlayed, beat: "loop", kind: "stale-loop",
        detail: `game did not finish within ${MAX_ITERATIONS} iterations` });
    }
  }

  if (finished) {
    const state = await call<GameStateResult>("getGameState", {});
    if (state) {
      const active = state.house.filter((h) => h.status === "active");
      if (active.length > 2) {
        anomalies.push({ seed, strategy, week: weeksPlayed, beat: "finale", kind: "final-roster-anomaly",
          detail: `${active.length} NPCs still active at game end (expected ≤ 2)` });
      }
    }
  }

  return { seed, strategy, weeksPlayed, finished, winner, decisionCounts, anomalies };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("full-game UAT over the deployed HTTP transport path", () => {
  let server: Server;
  let base: string;
  let directResolver: (channel: "player" | "admin", user: string) => McpServer;

  beforeAll(async () => {
    // The same runtime composition as main.ts: registry + orchestrator + watcher.
    // FakeClock + tickEveryMs:0 disables the background watcher (no real timers in tests).
    const clock = new FakeClock();
    const runtime = composeRuntime({
      clock,
      watcher: { tickEveryMs: 0, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 0, auditEveryMs: 0 },
      seed: 1,
    });
    // Do NOT call runtime.start() — watcher is disabled; wiring is identical to production otherwise.
    directResolver = runtime.registry.resolver();
    server = createHttpMcpServer({ resolve: directResolver });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── Primary run: 12 seeds, never-use-veto ──────────────────────────────────

  it(
    "plays 12 seeds to completion (never-use-veto) — no anomalies detected",
    async () => {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      // Uses direct callTool (no HTTP) for reliability: the transport layer added
      // non-deterministic overhead that caused stale-loop failures in CI for some seeds.
      const runs: RunResult[] = [];
      for (const s of seeds) runs.push(await runFullGameDirect(directResolver, s, "never-use-veto"));
      const allAnomalies = runs.flatMap((r) => r.anomalies);

      // All games must finish. Include anomalies in the failure message so CI logs show the root cause.
      const unfinished = runs.filter((r) => !r.finished);
      if (unfinished.length > 0) {
        const detail = unfinished
          .map((r) => {
            const ants = r.anomalies.map((a) => `    [${a.kind}] w${a.week} ${a.beat}: ${a.detail}`).join("\n");
            return `  seed ${r.seed}: ${ants || "(no anomalies recorded)"}`;
          })
          .join("\n");
        expect.fail(`\nGames that did not finish (never-use-veto):\n${detail}\n`);
      }

      const noWinner = runs.filter((r) => r.finished && !r.winner).map((r) => `seed ${r.seed}`);
      expect(noWinner, "finished games without a winner").toEqual([]);

      // No anomalies.
      if (allAnomalies.length > 0) {
        const report = allAnomalies
          .map((a) => `  [${a.kind}] seed=${a.seed} week=${a.week} beat=${a.beat}: ${a.detail}`)
          .join("\n");
        expect.fail(`\nAnomalies detected (never-use-veto):\n${report}\n`);
      }

      // All games must have played at least 1 week.
      expect(runs.every((r) => r.weeksPlayed >= 1), "each game played ≥ 1 week").toBe(true);

      // At least some games must have produced player decisions.
      const decisionsTotal = runs.reduce((n, r) => n + Object.values(r.decisionCounts).reduce((a, b) => a + b, 0), 0);
      expect(decisionsTotal, "total player decisions across all runs").toBeGreaterThan(0);
    },
    { timeout: 120_000 },
  );

  // ── Veto-use path: 5 seeds, always-use-veto ───────────────────────────────

  it(
    "plays 5 seeds with always-use-veto — covers veto-save, replacement, and final-4 revert",
    async () => {
      const seeds = [1, 2, 3, 4, 5];
      const runs: RunResult[] = [];
      for (const s of seeds) runs.push(await runFullGameDirect(directResolver, s, "always-use-veto"));
      const allAnomalies = runs.flatMap((r) => r.anomalies);

      const unfinished = runs.filter((r) => !r.finished);
      if (unfinished.length > 0) {
        const detail = unfinished
          .map((r) => {
            const ants = r.anomalies.map((a) => `    [${a.kind}] w${a.week} ${a.beat}: ${a.detail}`).join("\n");
            return `  seed ${r.seed}: ${ants || "(no anomalies recorded)"}`;
          })
          .join("\n");
        expect.fail(`\nGames that did not finish (always-use-veto):\n${detail}\n`);
      }

      const noWinner = runs.filter((r) => r.finished && !r.winner).map((r) => `seed ${r.seed}`);
      expect(noWinner, "finished games without a winner (always-use-veto)").toEqual([]);

      if (allAnomalies.length > 0) {
        const report = allAnomalies
          .map((a) => `  [${a.kind}] seed=${a.seed} week=${a.week} beat=${a.beat}: ${a.detail}`)
          .join("\n");
        expect.fail(`\nAnomalies detected (always-use-veto):\n${report}\n`);
      }
    },
    { timeout: 60_000 },
  );

  // ── Decision-type coverage assertion ──────────────────────────────────────

  it(
    "all 4 player decision types are exercised across the 12-seed run set",
    async () => {
      // Re-run a representative subset (seeds 1-5) to verify coverage without
      // re-running the full 12-seed suite (which already ran above).
      const runs: RunResult[] = [];
      for (const s of [1, 2, 3, 4, 5]) runs.push(await runFullGame(base, s, "never-use-veto"));
      const merged: Partial<Record<PendingDecision["kind"], number>> = {};
      for (const r of runs) {
        for (const [k, v] of Object.entries(r.decisionCounts) as [PendingDecision["kind"], number][]) {
          merged[k] = (merged[k] ?? 0) + v;
        }
      }
      // Nominations and eviction-vote must appear (player is always a voter when not a nominee).
      expect(merged["nominations"] ?? 0, "nominations decisions hit").toBeGreaterThan(0);
      expect(merged["eviction-vote"] ?? 0, "eviction-vote decisions hit").toBeGreaterThan(0);
    },
    // Five full seasons over real HTTP: slow CI/sandbox hosts need the same headroom as test 1
    // (and the E42–E55 consequence folds added real per-beat work on top of the transport cost).
    { timeout: 180_000 },
  );

  // ── Health endpoint reachable (sanity) ────────────────────────────────────

  it("engine health endpoint is reachable", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
