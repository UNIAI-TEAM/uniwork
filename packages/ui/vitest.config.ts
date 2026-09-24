import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    ...vitestPoolOptions(),
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "test/**", "**/*.config.*", "components/ui/**"],
      reporter: ["text-summary"],
      // docs/engineering/GATE_LEVELS.md — at GATE_LEVEL=fast a drop below
      // these prints the summary and passes; standard and above fail on it.
      // The numbers never move down (docs/adr/0014-*.md).
      thresholds: coverageThresholds({ statements: 5, branches: 7, functions: 5, lines: 5 }),
    },
  },
});
