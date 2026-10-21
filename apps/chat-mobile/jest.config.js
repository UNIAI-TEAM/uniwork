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
  // components/ and the data layer's React hooks (data/**/*.test.tsx): vitest
  // keeps data/**/*.test.ts, so the two still never share a file.
  testMatch: ["<rootDir>/components/**/*.test.tsx", "<rootDir>/data/**/*.test.tsx"],
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
    // UNI-2053: the crash screen, the toasts, the update gate and Settings › About.
    "components/ui/error-fallback.tsx",
    "components/ui/toast-host.tsx",
    "components/app/update-gate.tsx",
    "components/settings/about-section.tsx",
    // The calls hook (data/realtime/use-call-realtime.test.tsx): the kill switch must not end a call.
    "data/realtime/use-call-realtime.ts",
    // UNI-2053 S2 store compliance: deleting the account, Privacy & legal, the AI
    // notice (and the catch-up sheet it gates), reporting and blocking, licenses.
    "components/settings/delete-account.tsx",
    "components/settings/legal-section.tsx",
    "components/settings/settings-row.tsx",
    "components/settings/licenses-list.tsx",
    "components/settings/use-open-web-page.ts",
    "components/chat/ai-consent-notice.tsx",
    "components/chat/catch-up-sheet.tsx",
    "components/chat/report-sheet.tsx",
    "components/chat/room-safety.tsx",
    // UNI-2053 S3: the "Connecting…" banner.
    "components/chat/connection-banner.tsx",
  ],
  coverageReporters: ["text-summary"],
  // Measured on the files above; only ever raised (CLAUDE.md › Coverage only
  // goes up). Blocks at every GATE_LEVEL (ADR 0037). Raised with UNI-2053's
  // four components (97.2 / 90.05 / 94.8 / 99.1), then with S2's store
  // compliance screens, each at 100 % (98.72 / 93.64 / 97.67 / 99.59).
  coverageThreshold: { global: { statements: 98, branches: 93, functions: 97, lines: 99 } },
};
