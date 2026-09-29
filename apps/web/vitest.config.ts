import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

// apps/web has no screen tests: shared screens are tested in packages/views.
// This single runner owns host-only platform code: the sandboxed HTML preview,
// the protected Office draft store/key provider, and navigation adapter guards.
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
      // Keep every browser Office source in the canonical gate; unit fakes are
      // test-only and are excluded by the test suffix below.
      include: ["platform/office/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary"],
      // docs/engineering/GATE_LEVELS.md; the numbers only go up (ADR 0014).
      // Measured on the complete host suite (113 tests) at the first
      // implementation baseline: 81.76/81.90/80.30/86.30. Keep integer
      // floors so strict mode enforces that baseline and the ratchet can only
      // move upward with additional coverage.
      thresholds: coverageThresholds({ statements: 81, branches: 81, functions: 80, lines: 86 }),
    },
  },
});
