import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{main,preload,renderer,shared,test}/**/*.test.ts"],
    ...vitestPoolOptions(),
    coverage: {
      provider: "v8",
      include: ["main/**/*.ts", "preload/**/*.ts", "renderer/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      // The host is intentionally small and policy-heavy. These floors are
      // the measured baseline for this scaffold and may only ratchet upward.
      thresholds: coverageThresholds({ statements: 80, branches: 70, functions: 80, lines: 80 }),
    },
  },
});
