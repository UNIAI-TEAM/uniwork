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
];
