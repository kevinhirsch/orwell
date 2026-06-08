import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The architecture test shells out to dependency-cruiser, which can take a
    // moment on a cold cache; give the whole suite generous headroom.
    testTimeout: 30_000,
  },
});
