import { defineConfig } from "vitest/config";

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
      // its real level and should only move UP.
      thresholds: {
        branches: 80,
        "src/engine/**": { branches: 90 },
        "src/composition/**": { branches: 88 },
        "src/adapters/engine/**": { branches: 82 },
      },
    },
  },
});
