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

// The import boundary (ADR 0011) every file keeps; the UI block below adds the mutation layer's.
const restrictedPaths = [
  ...lucideAliasPaths,
  {
    // Audit C2: a sheet left open sits over the ringing call's Answer button.
    name: "react-native",
    importNames: ["Modal"],
    message: "Use CallAwareModal (components/ui/call-aware-modal.tsx): an incoming call closes it.",
  },
];
const restrictedPatterns = [
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
    // A types module on the allowlist (a pure zod schema, e.g. types/ai) may be imported for its values too.
    group: ["@uniwork/core/types/*", ...CORE_ALLOWLIST.filter((entry) => entry.startsWith("types/")).map((entry) => `!@uniwork/core/${entry}`)],
    allowTypeImports: true,
    message: "@uniwork/core/types/* is `import type` only on mobile, unless allowlisted (ADR 0011).",
  },
];

// Every rule of no-restricted-syntax lives in one list: a later config block
// naming the rule replaces its options, it does not add to them.
const restrictedSyntax = [
  {
    // no-restricted-imports does not see `import()`; a dynamic import of core would
    // typecheck (core exports the barrels) and drag web-only code into Metro.
    selector: "ImportExpression > Literal[value=/^@uniwork\\u002fcore/]",
    message: "No dynamic import of @uniwork/core on mobile; use a static import of an allowlisted subpath (ADR 0011).",
  },
  {
    // A failure swallowed with no trace (audit "observability holes"): a handler that
    // takes no error and returns nothing, null or [].
    selector:
      "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0]:matches([body.type='Identifier'][body.name='undefined'], [body.type='Literal'][body.raw='null'], [body.type='BlockStatement'][body.body.length=0], [body.type='ArrayExpression'][body.elements.length=0])",
    message: "Do not swallow a failure: .catch(bestEffort(scope, what, \"report\" | \"breadcrumb\")) from data/report.ts, or settled() from lib/settled.ts to only wait.",
  },
];

// The mutation layer (data/mutations/command.ts): screens and components
// change server state through its hooks, never by calling an endpoint or a
// command themselves, nor reach the transport (data/api.ts). Types stay importable.
const COMMAND_MODULES = ["api", "chat-api", "chat-actions", "chat-send", "pending-ops", "safety-api", "safety-actions", "account-api", "ai-consent"];

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
  // Maestro's runScript files run in its own JavaScript engine, with its
  // http and output objects and the flow's -e inputs as globals.
  {
    files: ["maestro/scripts/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { http: "readonly", output: "writable", MAESTRO_API_URL: "readonly", MAESTRO_CALLER_TOKEN: "readonly", MAESTRO_CALLER_WS_ID: "readonly", MAESTRO_DM_ROOM_ID: "readonly" },
    },
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
  // A screen or a card draws what the model layer narrowed (lib/message-display.ts ›
  // messageContent carries each card's payload): no `x!` that a drifted record turns into a
  // TypeError in a list cell. Tests may assert.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "error" },
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
      "no-restricted-syntax": ["error", ...restrictedSyntax],
      "@typescript-eslint/no-restricted-imports": ["error", { paths: restrictedPaths, patterns: restrictedPatterns }],
    },
  },
  // lib/ is the pure layer (CLAUDE.md › Cấu trúc): logic node can run, tested by vitest at a
  // 100% floor. No React, no platform or native module, no Sentry, and nothing from the layers
  // above it (data/, components/, app/); a type from them is fine. Replaces the rule's options
  // for lib/, so it restates the boundary above.
  {
    files: ["lib/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: restrictedPaths,
        patterns: [
          ...restrictedPatterns,
          {
            group: ["react", "react-*", "react-native", "react-native-*", "@react-native-*/*", "expo", "expo-*", "@expo/*", "@sentry/*", "nativewind", "@livekit/*", "livekit-client"],
            allowTypeImports: true,
            message: "lib/ is pure (node-testable): a hook, a provider or a native call belongs in components/ or data/.",
          },
          {
            group: ["@/data/*", "@/data", "**/data/*", "@/components/*", "**/components/*", "@/app/*"],
            allowTypeImports: true,
            message: "lib/ sits below data/ and components/: import types only, or move the shared logic into lib/.",
          },
        ],
      }],
    },
  },
  // Replaces the rule's options for app/ and components/, so it restates the boundary above.
  // app/_layout.tsx and app/(app)/_layout.tsx are the composition roots: they hand the transport
  // and endpoints to boot services (push registration) as dependencies.
  // Tests import the endpoint modules they mock (the transport stays the seam, as in packages/views).
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["app/_layout.tsx", "app/(app)/_layout.tsx", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: [
          ...restrictedPaths,
          {
            name: "@/data/queries/devices",
            importNames: ["revokeDevice"],
            message: "Revoke a device with useRevokeDevice (data/mutations/account.ts).",
          },
          {
            name: "@/data/push",
            importNames: ["setPushEnabled", "registerPushToken", "unregisterPushToken"],
            message: "Turn push on or off with useSetPushEnabled (data/mutations/push.ts); registration at boot is app/(app)/_layout.tsx's.",
          },
        ],
        patterns: [
          ...restrictedPatterns,
          {
            group: COMMAND_MODULES.flatMap((name) => [`@/data/${name}`, `**/data/${name}`]),
            allowTypeImports: true,
            message: "Change server state through a data/mutations/* hook; screens never call an endpoint or a command (data/mutations/command.ts).",
          },
        ],
      }],
    },
  },
];
