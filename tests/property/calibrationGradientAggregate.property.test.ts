import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SEEDS, assertGradient, type GradientResult } from "./calibrationGradientShared";

/**
 * Calibration GRADIENT gate, AGGREGATE (sharded 2026-06-19).
 *
 * The companion {@link file://./calibrationGradient.property.test.ts} shard runner fans the
 * {@link SEEDS} passive+active sweeps out across CI runners; each shard writes its per-seed
 * measurements to a JSON artifact. This is the recombination step: it reads EVERY shard artifact,
 * reconstructs the full set of seeds 1..SEEDS, and runs the ONE distribution assertion
 * ({@link assertGradient}) — the SAME monotonic band (active jury-reach ≥ passive AND active wins ≥
 * passive, with the sanity floor) that the pre-shard single-file gate ran. Because each seed's
 * passive+active pair is independent and per-seed seeded, the recombined distribution is identical
 * to playing all seeds in one process; sharding only moved WHERE each seed was played, never the
 * property or the numbers.
 *
 * This is the REPORTED required check for the gradient calibration: it is green only if the full
 * band holds. The shards themselves make no band assertion (a slice can't see the distribution).
 *
 * Shard artifacts are collected under `GRADIENT_RESULTS_DIR` (CI downloads every shard's uploaded
 * artifact into one directory before this runs). Roles only — no houseguest names.
 */

const RESULTS_DIR = process.env.GRADIENT_RESULTS_DIR ?? join("tmp", "gradient-shards");

interface ShardFile {
  shard: number;
  results: GradientResult[];
}

/** Load and flatten every `gradient-shard-*.json` artifact under the results dir. */
function loadAllShardResults(dir: string): GradientResult[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => /^gradient-shard-.*\.json$/.test(n));
  } catch {
    throw new Error(
      `no gradient shard artifacts found at ${dir} — run the shard runner (GRADIENT_SHARDS=N GRADIENT_SHARD=k npm run test:heavy:gradient) for every shard first, or set GRADIENT_RESULTS_DIR`,
    );
  }
  const all: GradientResult[] = [];
  for (const name of names.sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as ShardFile;
    all.push(...parsed.results);
  }
  return all;
}

describe("calibration gradient aggregate — the full band over all shards", () => {
  it(
    `recombines every shard artifact and asserts the gradient band across all ${SEEDS} seeds`,
    () => {
      const results = loadAllShardResults(RESULTS_DIR);
      // assertGradient recombines by seed and FAILS if any of 1..SEEDS is missing or duplicated — so
      // a dropped/empty shard artifact is caught here, not silently passed.
      assertGradient(results, expect as never);
    },
  );
});
