import reactConfig from "@uniwork/eslint-config/react";
import { lucideAliasPaths } from "@uniwork/eslint-config/base";
import i18next from "eslint-plugin-i18next";
import reactNativeA11y from "eslint-plugin-react-native-a11y";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The only @uniwork/core subpaths a phone can carry (pure functions, zod
// schemas). One file feeds this rule and scripts/mobile-core-allowlist.test.mjs,
// which checks what each entry pulls in transitively.
const CORE_ALLOWLIST = JSON.parse(readFileSync(fileURLToPath(new globalThis.URL("./core-allowlist.json", import.meta.url)), "utf8"));

export default [
  ...reactConfig,
  { ignores: [".expo/", "dist/", "coverage/", "android/", "ios/"] },
  // Expo and Jest load these as CommonJS (the jest resolver and asset stub too,
  // and the config plugins app.config.ts names by path).
  {
    files: ["*.config.js", "test/*.js", "plugins/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { require: "readonly", module: "writable", __dirname: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Node scripts (scripts/sync-i18n.mjs) run outside the bundle.
  { files: ["scripts/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
  // The base config turns this off for the web packages; the app's types are
  // strict end to end, so `any` stays out (unknown + a schema instead).
  { files: ["**/*.{ts,tsx}"], rules: { "@typescript-eslint/no-explicit-any": "error" } },
  // jsx-a11y (from the react config) knows DOM elements only. These are the
  // React Native ones: valid roles, states, values, actions, live regions and
  // importantForAccessibility, and no touchable inside a touchable. The `all`
  // preset is basic + iOS + Android, the two platforms the app ships.
  {
    files: ["**/*.tsx"],
    plugins: { "react-native-a11y": reactNativeA11y },
    rules: {
      ...reactNativeA11y.configs.all.rules,
      // Off on purpose: it demands an accessibilityHint on every labelled
      // element. Apple's and Google's guidance is that a hint is optional and
      // only for an outcome the label does not make obvious; a hint on every
      // control doubles what VoiceOver/TalkBack read and buries the label.
      "react-native-a11y/has-accessibility-hint": "off",
    },
  },
  // Logs go through data/logger.ts (UNI-2053): a breadcrumb for crash reports,
  // the console in a development build only. data/logger.ts is the one writer.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "data/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "data/logger.ts"],
    rules: { "no-console": "error" },
  },
  // Every JSX text node goes through t(), as in packages/views: copy lives in
  // locales/ (scripts/sync-i18n.mjs), in Vietnamese and English.
  {
    files: ["**/*.tsx"],
    ignores: ["**/*.test.tsx", "test/**"],
    plugins: { i18next },
    rules: { "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }] },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    rules: {
      "import-x/no-extraneous-dependencies": ["error", {
        devDependencies: [
          "**/*.test.{ts,tsx}",
          "app.config.ts",
          "babel.config.js",
          "metro.config.js",
          "tailwind.config.js",
          "vitest.config.ts",
          "jest.config.js",
          "test/**",
          "eslint.config.mjs",
        ],
        peerDependencies: true,
      }],
      // ADR 0011: the import boundary is a lint rule, not a convention. The
      // typescript-eslint variant knows `import type`, so types/* stays open to
      // type-only imports and closed to values.
      "no-restricted-imports": "off",
      // no-restricted-imports does not see `import()`; a dynamic import of core would
      // typecheck (core exports the barrels) and drag web-only code into Metro.
      "no-restricted-syntax": ["error", {
        selector: "ImportExpression > Literal[value=/^@uniwork\\u002fcore/]",
        message: "No dynamic import of @uniwork/core on mobile; use a static import of an allowlisted subpath (ADR 0011).",
      }],
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: [
          ...lucideAliasPaths,
          {
            // Audit C2: a sheet left open sits over the ringing call's Answer button.
            name: "react-native",
            importNames: ["Modal"],
            message: "Use CallAwareModal (components/ui/call-aware-modal.tsx): an incoming call closes it.",
          },
        ],
        patterns: [
          {
            group: ["@uniwork/views", "@uniwork/views/*", "@uniwork/ui", "@uniwork/ui/*", "next", "next/*"],
            message: "Mobile owns its UI and never hosts views/ui/next (ADR 0011).",
          },
          {
            group: ["@react-navigation/*"],
            message: "Import navigation hooks and themes from expo-router; its navigation context is separate.",
          },
          {
            group: ["**/packages/**", "**/node_modules/**"],
            message: "Reach packages/core through @uniwork/core/<allowlisted subpath>, never by relative path.",
          },
          {
            // A regex, not a group: gitignore-style `!` negations cannot
            // re-include a path under an excluded parent, so an allowlist is
            // impossible with `group`. types/* is left to the pattern below.
            regex: `^@uniwork/core(?!/(?:types/[^/]+|${CORE_ALLOWLIST.join("|")})$)(?:/.*)?$`,
            caseSensitive: true,
            message: "Only the pure modules in scripts/mobile-core-allowlist.test.mjs may be imported from @uniwork/core (ADR 0011).",
          },
          {
            group: ["@uniwork/core/types/*"],
            allowTypeImports: true,
            message: "@uniwork/core/types/* is `import type` only on mobile (ADR 0011).",
          },
        ],
      }],
    },
  },
];
