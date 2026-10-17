import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

// Main-process modules are pure functions tested without Electron (`electron`
// is mocked with vi.mock where a module touches it), so the runner is node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    ...vitestPoolOptions(),
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts is app-lifecycle wiring, smoke-tested by hand (plan Task 4).
      exclude: ["**/*.test.ts", "src/main/index.ts"],
      reporter: ["text-summary"],
      thresholds: coverageThresholds({ statements: 100, branches: 100, functions: 100, lines: 100 }),
    },
  },
});
