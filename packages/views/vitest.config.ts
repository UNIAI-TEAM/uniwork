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
      exclude: ["**/*.test.{ts,tsx}", "test/**", "**/*.config.*"],
      reporter: ["text-summary"],
      thresholds: { statements: 49, branches: 46, functions: 38, lines: 51 },
    },
  },
});
