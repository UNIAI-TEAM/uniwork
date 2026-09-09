import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

export default defineConfig({
  plugins: [react()],
  // jsdom rather than node: the feature-flag and i18n providers are React and
  // have to mount. `setup.ts` unmounts between cases — without it Testing
  // Library keeps every previous render in the same document and any
  // `getByTestId` finds several matches.
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    ...vitestPoolOptions(),
    // 5s tripped under `make check`: three suites run in parallel with v8
    // coverage on. A test that needs more than this is a real problem.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "test/**", "**/*.config.*"],
      reporter: ["text-summary"],
      thresholds: { statements: 58, branches: 53, functions: 47, lines: 60 },
    },
  },
});
