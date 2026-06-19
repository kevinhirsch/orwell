import { defineConfig } from "vitest/config";

/**
 * The heavy, end-to-end SIMULATION files — full live seasons played to completion.
 * They are intentional calibration/UAT guarantees (anti-sycophancy #3) and they dominate
 * wall-clock (each plays many full seasons). CI keeps them in the FUNCTIONAL gate but runs
 * them in a dedicated, PARALLEL job (`test:heavy`) so the main unit job returns fast, and
 * EXCLUDES them from the COVERAGE run only: under v8 instrumentation they re-execute the whole
 * live loop a second, slower time yet add no BRANCH coverage in the gated dirs that the rest of
 * the live-loop suite (restartSpine, liveProgression, liveSeason, advanceToFinale, playerEviction,
 * liveSentinel, liveFairness, …) does not already cover. The per-directory branch thresholds
 * below still hold with these excluded (re-measured; ratchet UP only).
 *
 * Single source of truth: `test:heavy` runs exactly this set; `test:unit:fast` and the coverage
 * run exclude exactly this set. Keep the three in lockstep (the npm scripts reference these globs).
 */
export const HEAVY_SIM_FILES = [
  "tests/uat/**",
  "tests/property/juryReach.property.test.ts",
  "tests/property/calibrationGradient.property.test.ts",
];

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The architecture test shells out to dependency-cruiser, which can take a
    // moment on a cold cache; give the whole suite generous headroom.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/ports/**", "src/main.ts"],
      // Coverage thresholds (B70/audit C8): CI runs `test:cov`, so coverage can no longer
      // silently regress. Per-directory BRANCH floors sit just under today's measured levels
      // (engine 92.7 · composition 90 · adapters/engine ~86 after the C9 fail-closed tests) —
      // the audit's ≥90 target is met for engine/composition; adapters/engine is ratcheted from
      // its real level and should only move UP. Re-measured with HEAVY_SIM_FILES excluded from
      // the coverage run: every per-directory branch floor still passes (the heavy sims add no
      // gated-dir branch coverage the rest of the live-loop suite doesn't already provide).
      thresholds: {
        branches: 80,
        "src/engine/**": { branches: 90 },
        "src/composition/**": { branches: 88 },
        "src/adapters/engine/**": { branches: 82 },
      },
    },
  },
});
