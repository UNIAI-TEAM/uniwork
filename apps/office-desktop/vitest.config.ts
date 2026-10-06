import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

export default defineConfig({
  plugins: [react()],
  test: {
    // Main/preload/shared stay on node (fs, protocol handlers, no DOM); each
    // renderer test file opts into jsdom with its own `@vitest-environment`
    // docblock since it is a real browser UI needing React + Testing Library.
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["{main,preload,renderer,shared,test}/**/*.test.{ts,tsx}"],
    // A loaded Windows host can starve a heavy main/renderer file past the
    // default 5 s budget, and the heavy engine save-recovery tests have been seen
    // past 20 s on a loaded runner; the WSL branch below uses the same budget.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    ...vitestPoolOptions(),
    coverage: {
      provider: "v8",
      include: ["main/**/*.ts", "preload/**/*.ts", "renderer/**/*.{ts,tsx}", "shared/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      // The host is intentionally small and policy-heavy. These floors are
      // the measured baseline for this scaffold and may only ratchet upward.
      thresholds: coverageThresholds({ statements: 80, branches: 70, functions: 80, lines: 80 }),
    },
  },
});
