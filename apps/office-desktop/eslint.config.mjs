import reactConfig from "@uniwork/eslint-config/react";

export default [
  ...reactConfig,
  {
    ignores: ["dist/**", "coverage/**"],
  },
];
