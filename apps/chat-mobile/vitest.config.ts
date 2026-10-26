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
    include: ["app.config.test.ts", "android-manifest.test.ts", "store-listing.test.ts", "native-modules.test.ts", "lib/**/*.test.ts", "data/**/*.test.ts"],
    ...vitestPoolOptions(),
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "data/**/*.ts"],
      // realtime-provider and use-ws-subscriptions are React (AppState/NetInfo/Platform, the
      // socket's context), and query-client wires AppState / NetInfo into TanStack at module
      // load. lib/ has no such file: it is pure by lint (eslint.config.mjs › lib/), so all of it
      // is measured. Never exclude a file to pass the floor (ADR 0043); component code is
      // covered by the jest-expo layer (jest.config.js), not here.
      exclude: [
        "**/*.test.ts",
        "data/realtime/realtime-provider.*",
        "data/realtime/use-ws-subscriptions.ts",
        "data/query-client.ts",
        // The chat hook only wires chat-realtime.ts (tested) to the socket, AppState and NetInfo.
        "data/realtime/use-chat-realtime.ts",
        // The call wiring: the engine (call-engine.ts, tested) on the chat API and the socket.
        "data/calls/call-store.ts",
        // React hooks: rendered and measured by the jest-expo layer (jest.config.js).
        "data/realtime/use-call-realtime.ts",
        "data/realtime/use-workspace-realtime.ts",
        "data/use-account-sync.ts",
        "data/queries/use-room-timeline.ts",
        // The mutation layer's hooks (useMutation over the commands tested here): rendered and measured by
        // the jest-expo layer (data/mutations/mutations.test.tsx).
        "data/mutations/**",
      ],
      reporter: ["text-summary"],
      // Blocks at every GATE_LEVEL (ADR 0043): not routed through scripts/coverage-gate.ts.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
