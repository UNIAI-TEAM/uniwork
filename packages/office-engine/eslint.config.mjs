import baseConfig from "@uniwork/eslint-config/base";

export default [
  ...baseConfig,
  // The boundary rule this package exists to enforce (ADR 0021): the browser
  // entry and the shared facade must never resolve Node, Electron, native or
  // canvas - even transitively. scripts/office/check-boundaries.mjs proves it
  // on the tree; this lint rule is the first line of defence. The /node and
  // /desktop entries may use runtime facilities; src/browser/**, src/index.ts
  // and src/shared/** may not.
  {
    files: ["src/index.ts", "src/browser/**/*.ts", "src/shared/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["node:*", "electron", "electron/*", "@napi-rs/*", "canvas", "*.node"],
            message:
              "Browser-facing office-engine code must not resolve Node/Electron/native/canvas. Put it in src/node or src/desktop.",
          },
          {
            group: ["*/node/*", "../node/*", "../node", "../../node/*"],
            message: "src/browser must not import the node entry - even for types.",
          },
        ],
      }],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "Browser-facing office-engine code must not read process.env. Configuration arrives as values.",
      }],
    },
  },
  {
    files: ["src/node/**/*.ts", "src/desktop/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "Read configuration from constructor options, not process.env, so hosts stay injectable.",
      }],
    },
  },
];
