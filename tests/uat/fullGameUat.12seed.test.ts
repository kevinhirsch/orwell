/**
 * tests/uat/fullGameUat.12seed.test.ts
 *
 * Heavy-sims lane: uat-12seed.
 *
 * The primary completion run — 12 seeds, never-use-veto, played to a winner via the
 * direct callTool path (no HTTP: the transport layer added non-deterministic overhead
 * that caused stale-loop failures in CI for some seeds). One of the three slices the
 * former single fullGameUat.test.ts was split into so its independent `it` blocks fan
 * out across separate CI runners; seeds and assertions are unchanged.
 *
 * See tests/uat/fullGameUatHarness.ts for the shared driver + invariant checkers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startUatHarness,
  runFullGameDirect,
  type UatHarness,
  type RunResult,
} from "./fullGameUatHarness";

describe("full-game UAT — 12 seeds (never-use-veto)", () => {
  let harness: UatHarness;

  beforeAll(async () => {
    harness = await startUatHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ── Primary run: 12 seeds, never-use-veto ──────────────────────────────────

  it(
    "plays 12 seeds to completion (never-use-veto) — no anomalies detected",
    async () => {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      // Uses direct callTool (no HTTP) for reliability: the transport layer added
      // non-deterministic overhead that caused stale-loop failures in CI for some seeds.
      const runs: RunResult[] = [];
      for (const s of seeds) runs.push(await runFullGameDirect(harness.directResolver, s, "never-use-veto"));
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
});
