import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

// apps/web has no screen tests: shared screens are tested in packages/views.
// This runner exists for the host-only office boundary in platform/office
// (G2-06: the sandboxed HTML preview), whose tests need a DOM.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["platform/office/**/*.test.ts"],
    ...vitestPoolOptions(),
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["platform/office/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary"],
      // docs/engineering/GATE_LEVELS.md; the numbers only go up (ADR 0014).
      thresholds: coverageThresholds({ statements: 99, branches: 100, functions: 93, lines: 99 }),
    },
  },
});
