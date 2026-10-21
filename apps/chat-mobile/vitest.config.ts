import path from "node:path";
import { defineConfig } from "vitest/config";
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
      // Never exclude a file to pass the floor (ADR 0037); component code is
      // covered by the jest-expo layer (jest.config.js), not here.
      exclude: [
        "**/*.test.ts",
        "lib/theme.ts",
        "lib/use-color-scheme.ts",
        "data/realtime/realtime-provider.*",
        "lib/use-ws-subscriptions.ts",
        "data/query-client.ts",
        // The chat hook only wires chat-realtime.ts (tested) to the socket, AppState and NetInfo.
        "data/realtime/use-chat-realtime.ts",
        // The call wiring: the engine (call-engine.ts, tested) on the chat API and the socket.
        "data/calls/call-store.ts",
        // A React hook: rendered and measured by the jest-expo layer (jest.config.js).
        "data/realtime/use-call-realtime.ts",
      ],
      reporter: ["text-summary"],
      // Blocks at every GATE_LEVEL (ADR 0037): not routed through scripts/coverage-gate.ts.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
