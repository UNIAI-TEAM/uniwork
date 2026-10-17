import path from "node:path";
import { defineConfig } from "vitest/config";
import { coverageThresholds } from "../../scripts/coverage-gate";
import { vitestPoolOptions } from "../../scripts/vitest-pool";

// Node environment only, for pure helpers in lib/, headless data-layer logic in
// data/ and app.config.ts. The app runs on Hermes with native shims, so a
// DOM-shaped runner would be a lie; nothing here renders React Native.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["app.config.test.ts", "lib/**/*.test.ts", "data/**/*.test.ts"],
    ...vitestPoolOptions(),
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "data/**/*.ts"],
      // theme.ts and use-color-scheme.ts import expo-router / nativewind, which
      // need the native runtime; realtime-provider imports react-native
      // (AppState/NetInfo/Platform), use-ws-subscriptions imports it, and
      // query-client wires AppState / NetInfo into TanStack at module load.
      exclude: [
        "**/*.test.ts",
        "lib/theme.ts",
        "lib/use-color-scheme.ts",
        "data/realtime/realtime-provider.*",
        "lib/use-ws-subscriptions.ts",
        "data/query-client.ts",
      ],
      reporter: ["text-summary"],
      thresholds: coverageThresholds({ statements: 100, branches: 100, functions: 100, lines: 100 }),
    },
  },
});
