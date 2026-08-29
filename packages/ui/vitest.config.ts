import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // 5s tripped under `make check`: three suites run in parallel with v8
    // coverage on. A test that needs more than this is a real problem.
    testTimeout: 30_000,
    // Ratchet: integer floors one point under what the suite covered when
    // this landed (v8 numbers jitter by a few tenths between runs). A drop
    // fails `pnpm test`; raise the floor by hand with the change that earned
    // it. Not `autoUpdate`: it writes the exact decimal and the next run
    // fails on jitter.
    coverage: {
      provider: "v8",
      include: ["**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "test/**", "**/*.config.*", "components/ui/**"],
      reporter: ["text-summary"],
      thresholds: { statements: 5, branches: 7, functions: 5, lines: 5 },
    },
  },
});
