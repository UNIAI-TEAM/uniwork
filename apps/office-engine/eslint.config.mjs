import baseConfig from "@uniwork/eslint-config/base";

export default [
  ...baseConfig,
  {
    files: ["src/**/*.ts"],
    ignores: ["**/*.test.ts", "src/main.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "Service configuration is injected by the deployer (src/main.ts), not read from process.env here.",
      }],
    },
  },
];
