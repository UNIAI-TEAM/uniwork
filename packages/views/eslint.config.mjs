import reactConfig from "@uniwork/eslint-config/react";
import i18next from "eslint-plugin-i18next";

// Global i18n protection: every JSX text node in this package must go through
// the translation hook. A raw string becomes a lint error. `jsx-text-only`
// flags JSX children only — attribute values and plain TS literals pass.
export default [
  ...reactConfig,
  {
    files: ["**/*.tsx"],
    ignores: ["**/*.test.tsx", "test/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }],
    },
  },
  // Package boundary: views is shared across platforms. Anything that reaches
  // for a framework router binds it to one host and makes the desktop/mobile
  // shells impossible without a rewrite. Navigation goes through
  // useNavigation() / <AppLink> from the platform adapter.
  //
  // import-x/no-extraneous-dependencies happens to reject these today only
  // because next is undeclared here; adding it to package.json would silence
  // that. This rule is the one that actually holds the boundary.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "test/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["next", "next/*"],
            message:
              "packages/views must stay framework-agnostic. Use useNavigation() or <AppLink> from the platform adapter; Next.js APIs belong in apps/web/platform/.",
          },
          {
            group: ["react-router-dom"],
            message:
              "packages/views must stay framework-agnostic. Use useNavigation() or <AppLink> from the platform adapter.",
          },
        ],
      }],
    },
  },
];
