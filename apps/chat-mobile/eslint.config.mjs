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
  {
    // A spinner says what it waits for (audit UX "no-device-a11y-verification"): TalkBack and VoiceOver
    // otherwise read a bare "in progress", or nothing at all inside a list footer.
    selector: "JSXOpeningElement[name.name='ActivityIndicator']:not(:has(JSXAttribute[name.name='accessibilityLabel']))",
    message: "Label the spinner: accessibilityLabel={t(\"common.loading\")}, or what is loading.",
  },
];

// Production code only (a test drives the toast store with any string it likes).
const copySyntax = [
  {
    // Copy built outside JSX, where the JSX copy rule below does not look (audit "copy lint does not cover .ts
    // modules"): a toast, an alert or a screen-reader announcement is read or heard by a person, in .ts modules too.
    selector:
      "CallExpression:matches([callee.object.name='toast'], [callee.object.name='Alert'], [callee.property.name=/^announceForAccessibility/]) > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral[quasis.0.value.raw=/[A-Za-z]/])",
    message: "Copy goes through t(): a toast, an alert or an announcement is read by a person (locales/, scripts/sync-i18n.mjs).",
  },
  {
    // A notification, its channel and its actions are drawn by the system from what the app hands it.
    selector:
      "CallExpression[callee.property.name=/^(scheduleNotificationAsync|setNotificationChannelAsync|setNotificationCategoryAsync|showIncomingCall|showOngoingCall)$/] Property[key.name=/^(title|body|subtitle|name|description|buttonTitle)$/] > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral[quasis.0.value.raw=/[A-Za-z]/])",
    message: "Notification copy goes through t() (locales/, scripts/sync-i18n.mjs): the system shows it as the app hands it.",
  },
];

// Spacing is logical (audit "rtl-not-ready"): ms-/me-/ps-/pe- (marginStart, paddingEnd, …) follow the layout direction,
// ml-/mr-/pl-/pr- do not. The app is left to right today (app.config.ts › supportsRTL false); a right-to-left language
// later is then a translation and a switch, not a layout rewrite. Positions, borders and corners stay physical for now.
const PHYSICAL_SPACING = "(^|[\\s:\"'`])-?(ml|mr|pl|pr)-(\\d|\\[|px\\b|auto\\b)";
const directionSyntax = [
  {
    selector: `Literal[value=/${PHYSICAL_SPACING}/]`,
    message: "Use logical spacing: ms-/me-/ps-/pe- instead of ml-/mr-/pl-/pr- (they follow the layout direction).",
  },
  {
    selector: `TemplateElement[value.raw=/${PHYSICAL_SPACING}/]`,
    message: "Use logical spacing: ms-/me-/ps-/pe- instead of ml-/mr-/pl-/pr- (they follow the layout direction).",
  },
];

// Numbers and dates are written in the app's language through lib/locale-format.ts (numberFormat, dateTimeFormat),
// never the device's region or a fixed format (audit "number-format-and-server-copy"). lib/locale-format.ts is the one
// place that builds an Intl formatter; tests and Node scripts may format as they like.
const formatSyntax = [
  {
    selector: "CallExpression[callee.property.name=/^(toFixed|toLocaleString|toLocaleDateString|toLocaleTimeString)$/]",
    message: "Write a number or a date through lib/locale-format.ts (numberFormat, dateTimeFormat): the app's language, not a fixed format.",
  },
  {
    selector: "NewExpression[callee.object.name='Intl']",
    message: "Build Intl formatters only in lib/locale-format.ts (cached, in the app's language).",
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
      globals: {
        http: "readonly",
        json: "readonly",
        output: "writable",
        MAESTRO_API_URL: "readonly",
        MAESTRO_APP_SCHEME: "readonly",
        MAESTRO_CALLER_EMAIL: "readonly",
        MAESTRO_CALLER_PASSWORD: "readonly",
        MAESTRO_CALLER_WS_ID: "readonly",
        MAESTRO_DM_ROOM_ID: "readonly",
      },
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
  // locales/ (scripts/sync-i18n.mjs), in Vietnamese and English. So does every
  // string in a JSX expression and every prop a person reads or hears: a
  // screen reader's label and hint, a placeholder, a title, a label, a message
  // (audit "i18n-guard-scope-rtl": jsx-text-only let those through). A prop
  // not listed (testID, className, icon names, routes) is not copy.
  {
    files: ["**/*.tsx"],
    ignores: ["**/*.test.tsx", "test/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": { include: ["accessibilityLabel", "accessibilityHint", "placeholder", "title", "label", "subtitle", "hint", "message", "description"] },
        },
      ],
    },
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
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "data/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "lib/locale-format.ts"],
    rules: { "no-restricted-syntax": ["error", ...restrictedSyntax, ...copySyntax, ...formatSyntax, ...directionSyntax] },
  },
  // A sheet that slides up is a BottomSheet (components/ui/bottom-sheet.tsx): its grabber drags it closed,
  // VoiceOver's escape closes it, reduce motion fades it. A raw CallAwareModal slide would bring back a
  // grabber that does nothing. Replaces the rule's options for app/ and components/, so it restates them.
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["components/ui/bottom-sheet.tsx", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...copySyntax,
        ...formatSyntax,
        ...directionSyntax,
        {
          selector: "JSXOpeningElement[name.name='CallAwareModal']:has(JSXAttribute[name.name='animationType'][value.value='slide'])",
          message: "A sliding sheet is a <BottomSheet> (components/ui/bottom-sheet.tsx): draggable, escapable, reduce-motion aware.",
        },
      ],
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
  // data/ sits below components/ and app/ (CLAUDE.md › Layers): a store, a query or a service never
  // reaches up into a screen or a component, not even for a type. What both need lives in data/ or lib/.
  // Replaces the rule's options for data/, so it restates the boundary above.
  {
    files: ["data/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: restrictedPaths,
        patterns: [
          ...restrictedPatterns,
          {
            group: ["@/components", "@/components/*", "**/components/*", "@/app", "@/app/*", "**/app/*"],
            message: "data/ sits below components/ and app/: move what both need into data/ or lib/, and inject platform effects from the composition root.",
          },
        ],
      }],
    },
  },
  // lib/ narrows unknown values with guards (lib/unknown-shape.ts), never a type assertion: a cast there is a
  // claim about a value the compiler cannot check, in the layer every other one trusts. `as const` stays allowed.
  {
    files: ["lib/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }] },
  },
  // A line says one thing (audit "max-lines defeated by long lines"): the 500-line file cap means little when a
  // line packs three statements or a whole function signature. URLs and regex literals are exempt.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "data/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "max-len": ["error", { code: 150, tabWidth: 2, ignoreUrls: true, ignoreRegExpLiterals: true }] },
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
