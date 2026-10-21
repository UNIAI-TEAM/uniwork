// The component layer (ADR 0037, audit T1): *.test.tsx under components/,
// rendered by jest-expo with React Native's own Jest preset and queried by
// role and label with @testing-library/react-native. The node vitest suite
// (vitest.config.ts) keeps lib/ and data/; the two never share a file.
// Never put a test under app/: expo-router would take it for a route.

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
].join("|");

/** @type {import("jest").Config} */
module.exports = {
  preset: "jest-expo",
  rootDir: __dirname,
  testMatch: ["<rootDir>/components/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/test/jest-setup.ts"],
  // React Native's preset maps images only; the ringtones are WAV.
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1", "\\.(wav|mp3|m4a)$": "<rootDir>/test/asset-stub.js" },
  // Worklets' JS fallback instead of its JSI runtime (see the file for why not upstream's).
  resolver: "<rootDir>/test/jest-resolver.js",
  transformIgnorePatterns: [`node_modules/(?!(?:\\.pnpm/)?(?:${TRANSPILE}))`],
  // A slow runner (CI, an 8 GB laptop) must not time out a first render.
  testTimeout: 15_000,
  collectCoverageFrom: [
    "components/chat/composer.tsx",
    "components/chat/message-row.tsx",
    "components/chat/room-row.tsx",
    "components/calls/call-overlay.tsx",
  ],
  coverageReporters: ["text-summary"],
  // Measured on the files above when the layer landed; only ever raised
  // (CLAUDE.md › Coverage only goes up). Blocks at every GATE_LEVEL (ADR 0037).
  coverageThreshold: { global: { statements: 96, branches: 89, functions: 93, lines: 98 } },
};
