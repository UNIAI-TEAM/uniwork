import baseConfig from "@uniwork/eslint-config/base";

export default [
  ...baseConfig,
  {
    ignores: ["dist/**", "coverage/**"],
  },
];
