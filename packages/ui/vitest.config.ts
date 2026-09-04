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
    coverage: {
      provider: "v8",
      include: ["**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "test/**", "**/*.config.*", "components/ui/**"],
      reporter: ["text-summary"],
      thresholds: { statements: 5, branches: 7, functions: 5, lines: 5 },
    },
  },
});
