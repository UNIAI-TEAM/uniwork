import { transform } from "esbuild";
import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

// apps/web has no screen tests: shared screens are tested in packages/views.
// This single runner owns host-only platform code: the Office frame host and
// its build pins, and navigation adapter guards.
export default defineConfig({
  plugins: [{
    name: "office-host-tsx",
    enforce: "pre",
    async transform(code, id) {
      if (!id.endsWith(".tsx")) return null;
      return transform(code, { loader: "tsx", jsx: "automatic", format: "esm", sourcemap: "inline", sourcefile: id });
    },
  }],
  test: {
    environment: "jsdom",
    include: ["platform/**/*.test.{ts,tsx}", "features/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    ...vitestPoolOptions(),
    coverage: {
      provider: "v8",
      // The Office frame host. The G3 browser host and its per-file floors left
      // with UNI-1240; the floor below is the first measured run (cloud r2).
      include: ["platform/office-frame/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}"],
      reporter: ["text-summary"],
      thresholds: coverageThresholds({ statements: 76, branches: 73, functions: 70, lines: 85 }),
    },
  },
});
