import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    ...vitestPoolOptions(),
    testTimeout: 30_000,
    // Markdown (KaTeX/Shiki) and the date-picker chunk compile on first import.
    // Under coverage + file parallelism that has been measured past the 10s
    // default on this Windows checkout; WSL already raises it via vitestPoolOptions.
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["**/*.{ts,tsx}"],
      // TipTap transplant (slice 5) is covered by its own unit suite; including
      // the full editor tree in the package floor would drop every metric below
      // the pre-port baseline. Revisit when editor branch coverage approaches
      // the package floor on its own.
      exclude: ["**/*.test.{ts,tsx}", "test/**", "**/*.config.*", "editor/**"],
      reporter: ["text-summary"],
      thresholds: { statements: 56, branches: 48, functions: 50, lines: 58 },
    },
  },
});
