import reactConfig from "@uniwork/eslint-config/react";
import { lucideAliasPaths } from "@uniwork/eslint-config/base";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The only @uniwork/core subpaths a phone can carry (pure functions, zod
// schemas). One file feeds this rule and scripts/mobile-core-allowlist.test.mjs,
// which checks what each entry pulls in transitively.
const CORE_ALLOWLIST = JSON.parse(readFileSync(fileURLToPath(new globalThis.URL("./core-allowlist.json", import.meta.url)), "utf8"));

export default [
  ...reactConfig,
  { ignores: [".expo/", "dist/", "coverage/", "android/", "ios/"] },
  // Expo loads these as CommonJS at build time.
  {
    files: ["*.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { require: "readonly", module: "writable", __dirname: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Node scripts (scripts/sync-i18n.mjs) run outside the bundle.
  { files: ["scripts/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
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
        paths: lucideAliasPaths,
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
