// The component layer (ADR 0037, audit T1): *.test.tsx under components/,
// rendered by jest-expo with React Native's own Jest preset and queried by
// role and label with @testing-library/react-native, and the route layer
// (test/routes/: route files through the real expo-router, test/route-render.tsx).
// The node vitest suite (vitest.config.ts) keeps lib/ and data/; the two never
// share a file. Never put a test under app/: expo-router would take it for a route.

// pnpm's isolated layout puts every package under node_modules/.pnpm/<name>@<v>/,
// so the allowlist is matched after an optional ".pnpm/" segment. These ship
// untranspiled ESM/Flow/JSX and must go through babel like the app's own code.
const TRANSPILE = [
  "(jest-)?react-native",
  "@react-native(-community)?",
  "expo(nent)?",
  "@expo(nent)?",
  "expo-[a-z-]+",
  "@expo-google-fonts",
  "@rn-primitives",
  "nativewind",
  "react-native-css-interop",
  "@livekit",
  "livekit-client",
  "@uniwork",
  "standard-navigation",
].join("|");

const path = require("node:path");

/** @type {import("jest").Config} */
module.exports = {
  preset: "jest-expo",
  rootDir: __dirname,
  // components/ and the data layer's React hooks (data/**/*.test.tsx): vitest
  // keeps data/**/*.test.ts, so the two still never share a file.
  testMatch: ["<rootDir>/components/**/*.test.tsx", "<rootDir>/data/**/*.test.tsx", "<rootDir>/test/routes/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/test/jest-setup.ts"],
  // React Native's preset maps images only; the ringtones are WAV.
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1", "\\.(wav|mp3|m4a)$": "<rootDir>/test/asset-stub.js" },
  // Worklets' JS fallback instead of its JSI runtime (see the file for why not upstream's).
  resolver: "<rootDir>/test/jest-resolver.js",
  transformIgnorePatterns: [`node_modules/(?!(?:\\.pnpm/)?(?:${TRANSPILE}))`],
  // A slow runner (CI, an 8 GB laptop) must not time out a first render.
  testTimeout: 15_000,
  // The whole component tree, the data layer's React hooks (the files vitest.config.ts leaves
  // out) and the route files, so every file of the app is measured by exactly one of the two layers;
  // a new component is measured the day it lands. Route files define no component or hook of their
  // own (lib/route-files.test.ts): they compose, and test/routes/ renders them through the real
  // router; they are held as one group (coverage-floor.json › routes).
  collectCoverageFrom: [
    "components/**/*.{ts,tsx}",
    "app/**/*.tsx",
    "data/mutations/*.ts",
    "data/calls/call-store.ts",
    "data/query-client.ts",
    "data/queries/use-room-timeline.ts",
    "data/realtime/realtime-provider.tsx",
    "data/realtime/use-call-realtime.ts",
    "data/realtime/use-chat-realtime.ts",
    "data/realtime/use-workspace-realtime.ts",
    "data/realtime/use-ws-subscriptions.ts",
    "data/use-account-sync.ts",
    "!**/*.test.{ts,tsx}",
  ],
  coverageDirectory: "<rootDir>/coverage/components",
  coverageReporters: ["text-summary", "json-summary"],
  coverageThreshold: coverageThreshold(),
};

/**
 * Each recorded file at its own floor (coverage-floor.json, written by
 * scripts/mobile-coverage-floor.mjs --write, which only ever raises one), the
 * route files (app/) together at the routes floor (a directory key: jest
 * aggregates it), and the files not recorded yet — a new component — together
 * at the global floor, so an untested one fails the run. Blocks at every
 * GATE_LEVEL (ADR 0037).
 */
function coverageThreshold() {
  const floor = require("./coverage-floor.json");
  // Absolute paths: jest resolves a threshold key against the working directory.
  const files = Object.fromEntries(Object.entries(floor.files).map(([file, pcts]) => [path.join(__dirname, file), pcts]));
  return { global: floor.global, [`${path.join(__dirname, "app")}/`]: floor.routes, ...files };
}
