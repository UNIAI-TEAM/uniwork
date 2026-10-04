import { transform } from "esbuild";
import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

// apps/web has no screen tests: shared screens are tested in packages/views.
// This single runner owns host-only platform code: the sandboxed HTML preview,
// the protected Office draft store/key provider, and navigation adapter guards.
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
    include: ["platform/**/*.test.{ts,tsx}"],
    // The pptx view graph registers i18n bundles at import time; initialize the
    // shared instance before each test module so that registration is a no-op
    // instead of a TypeError (see test/setup.ts).
    setupFiles: ["./test/setup.ts"],
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
      include: ["platform/office/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}"],
      reporter: ["text-summary"],
      // docs/engineering/GATE_LEVELS.md; the numbers only go up (ADR 0014).
      // Existing Office host files retain their historical floors. The two
      // new protected-draft files use integer floors from their measured
      // baseline; a global aggregate would incorrectly lower the old floors.
      thresholds: coverageThresholds({
        "platform/office/preview-gate.ts": { statements: 99, branches: 100, functions: 93, lines: 99 },
        "platform/office/preview.ts": { statements: 99, branches: 100, functions: 93, lines: 99 },
        "platform/office/draft-store.ts": { statements: 81, branches: 71, functions: 85, lines: 87 },
        "platform/office/draft-key-provider.ts": { statements: 62, branches: 63, functions: 65, lines: 68 },
      }),
    },
  },
});
