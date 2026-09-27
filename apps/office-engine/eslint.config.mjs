import baseConfig from "@uniwork/eslint-config/base";

export default [
  ...baseConfig,
  {
    files: ["src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "Service configuration is injected by the deployer, not read from process.env here.",
      }],
    },
  },
];
