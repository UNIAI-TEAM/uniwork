import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

// apps/web has no screen tests: shared screens are tested in packages/views.
// This runner exists for host-only platform code: the sandboxed HTML preview
// (platform/office, G2-06, whose tests need a DOM) and the navigation
// adapter's guard wiring (platform/navigation).
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["platform/**/*.test.ts"],
    ...vitestPoolOptions(),
    // The 20k-document DOM fuzz tests sit near 30 s under v8 coverage with
    // other files in parallel on this Windows checkout (measured 25-29 s in
    // isolation, >30 s with four files); 60 s matches the WSL pool policy and
    // still catches a real hang.
    testTimeout: 60_000,
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
