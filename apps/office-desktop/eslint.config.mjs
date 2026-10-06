import reactConfig from "@uniwork/eslint-config/react";

// The build and smoke scripts run under Node, not in a browser; the shared
// config declares no globals, so name the ones they read without importing.
const nodeGlobals = Object.fromEntries(
  ["process", "console", "Buffer", "URL", "setTimeout", "clearTimeout", "setInterval", "clearInterval"].map((name) => [name, "readonly"]),
);

export default [
  ...reactConfig,
  {
    files: ["scripts/**/*.{mjs,js}"],
    languageOptions: { globals: nodeGlobals },
  },
  {
    ignores: ["dist/**", "coverage/**"],
  },
];
