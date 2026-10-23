import baseConfig from "@uniwork/eslint-config/base";

export default [
  ...baseConfig,
  // Contract schemas must stay environment-neutral: a browser host, a Node
  // service and a Go parity reader all consume these types. Node builtins and
  // process.env never belong here.
  {
    files: ["src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["node:*", "electron", "electron/*", "@napi-rs/*", "canvas"],
          message:
            "@uniwork/office-contracts is environment-neutral. Runtime adapters live in @uniwork/office-engine.",
        }],
      }],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message:
          "@uniwork/office-contracts must not read process.env. Configuration arrives as values.",
      }],
    },
  },
];
