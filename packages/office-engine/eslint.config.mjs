import baseConfig from "@uniwork/eslint-config/base";

export default [
  ...baseConfig,
  // The boundary rule this package exists to enforce (ADR 0021): the shared
  // facade must never resolve Node, Electron, native or canvas. The /node
  // entry may use runtime facilities; src/index.ts and src/shared/** may not.
  {
    files: ["src/index.ts", "src/shared/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["node:*", "electron", "electron/*", "@napi-rs/*", "canvas", "*.node"],
            message:
              "The office-engine facade must not resolve Node/Electron/native/canvas. Put it in src/node.",
          },
          {
            group: ["*/node/*", "../node/*", "../node", "../../node/*"],
            message: "The facade must not import the node entry - even for types.",
          },
        ],
      }],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "The office-engine facade must not read process.env. Configuration arrives as values.",
      }],
    },
  },
  {
    files: ["src/node/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "Read configuration from constructor options, not process.env, so hosts stay injectable.",
      }],
    },
  },
];
