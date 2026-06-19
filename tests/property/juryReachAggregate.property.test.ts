import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SEEDS, assertBand, type SeasonResult } from "./juryReachShared";

/**
 * D4/E33 — the jury-reach calibration gate, AGGREGATE (sharded 2026-06-19).
 *
 * The companion {@link file://./juryReach.property.test.ts} shard runner fans the 20 passive
 * seeded seasons out across CI runners; each shard writes its per-season measurements to a JSON
 * artifact. This is the recombination step: it reads EVERY shard artifact, reconstructs the full
 * set of seeds 1..SEEDS, and runs the ONE distribution assertion ({@link assertBand}) — the SAME
 * floor/ceiling reach band, the SAME rare-F2-win ceiling, and the SAME earned-win teeth that the
 * pre-shard single-file gate ran. Because the seasons are independent and per-season seeded, the
 * recombined distribution is byte-identical to playing all 20 in one process; sharding only moved
 * WHERE each season was played, never the property or the numbers.
 *
 * This is the REPORTED required check for the jury calibration: it is green only if the full-20
 * band holds. The shards themselves make no band assertion (a slice can't see the distribution).
 *
 * Shard artifacts are collected under `JURY_RESULTS_DIR` (CI downloads every shard's uploaded
 * artifact into one directory before this runs). Roles only — no houseguest names.
 */

const RESULTS_DIR = process.env.JURY_RESULTS_DIR ?? join("tmp", "jury-shards");

interface ShardFile {
  shard: number;
  results: SeasonResult[];
}

/** Load and flatten every `jury-shard-*.json` artifact under the results dir. */
function loadAllShardResults(dir: string): SeasonResult[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => /^jury-shard-.*\.json$/.test(n));
  } catch {
    throw new Error(
      `no jury shard artifacts found at ${dir} — run the shard runner (JURY_SHARDS=N JURY_SHARD=k npm run test:heavy:jury) for every shard first, or set JURY_RESULTS_DIR`,
    );
  }
  const all: SeasonResult[] = [];
  for (const name of names.sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as ShardFile;
    all.push(...parsed.results);
  }
  return all;
}

describe("D4/E33 — jury-reach aggregate: the full-20 calibration band over all shards", () => {
  it(
    `recombines every shard artifact and asserts the band across all ${SEEDS} passive seasons`,
    () => {
      const results = loadAllShardResults(RESULTS_DIR);
      // assertBand recombines by seed and FAILS if any of 1..SEEDS is missing or duplicated — so a
      // dropped/empty shard artifact is caught here, not silently passed.
      assertBand(results, expect as never);
    },
  );
});
