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
      exclude: ["src/**/*.test.ts", "**/*.config.*"],
      reporter: ["text-summary"],
      thresholds: coverageThresholds({ statements: 72, branches: 72, functions: 78, lines: 74 }),
    },
  },
});
