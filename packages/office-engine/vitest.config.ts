import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

export default defineConfig({
  test: {
    environment: "node",
    ...vitestPoolOptions(),
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "test/**", "**/*.config.*"],
      reporter: ["text-summary"],
      thresholds: coverageThresholds({ statements: 96, branches: 88, functions: 98, lines: 98 }),
    },
  },
});
