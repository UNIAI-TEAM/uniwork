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
      // A full-page reload throws away the query cache, the socket and the
      // pending transition; navigation goes through the adapter.
      "no-restricted-globals": ["error", {
        name: "location",
        message: "packages/views must not reload the page. Use useNavigation().push()/replace().",
      }],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='window'][property.name='location']",
        message: "packages/views must not reload the page. Use useNavigation().push()/replace().",
      }, {
        // Native pickers look different on every browser; the registry
        // primitives are the one look the product ships.
        selector: "JSXOpeningElement[name.name=/^(select|datalist)$/]",
        message: "Use <Select> or <Combobox> from @uniwork/ui, not a native <select>/<datalist>.",
      }, {
        selector: "JSXOpeningElement JSXAttribute[name.name='type'][value.value=/^(date|time|datetime-local|month|week)$/]",
        message: "Use <DateField> (packages/views/common) or <TimeInput> from @uniwork/ui, not a native date/time input.",
      }],
      "no-restricted-imports": ["error", {
        // views ships to the browser and the sandboxed desktop renderer; OS
        // access belongs to the host (apps/office-desktop/main) behind an
        // adapter, never to a shared screen.
        paths: ["fs", "fs/promises", "path", "path/posix", "path/win32", "child_process", "electron"].map((name) => ({
          name,
          message: "packages/views runs in the browser and the sandboxed renderer. Reach the OS through a host adapter, not a Node built-in or electron.",
        })),
        patterns: [
          {
            group: ["node:*"],
            message: "packages/views runs in the browser and the sandboxed renderer. Reach the OS through a host adapter, not a Node built-in.",
          },
          {
            group: ["electron/*"],
            message: "packages/views must not import electron. Reach the OS through a host adapter.",
          },
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
