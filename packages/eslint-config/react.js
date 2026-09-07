import baseConfig from "./base.js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { react: reactPlugin },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
    },
    settings: { react: { version: "detect" } },
  },
  // Static accessibility: accessible names, label-to-control, alt text, media
  // captions. The rendered-page contracts (contrast, focus, touch targets)
  // live in e2e; this is the cheap half that runs on every lint.
  {
    files: ["**/*.{jsx,tsx}"],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Focusing the first field when a dialog opens is the expected behaviour;
      // the rule targets page-load autofocus, which nothing here does.
      "jsx-a11y/no-autofocus": "off",
      // Our form controls are registry primitives, not bare <input>s.
      "jsx-a11y/label-has-associated-control": ["error", {
        controlComponents: ["Input", "Textarea", "Select", "Checkbox", "Switch", "RadioGroup", "Slider"],
        // Label text may sit in a title/hint span pair: label > span > span.
        depth: 3,
      }],
    },
  },
  // Hooks rules apply to .ts too: useEffect / useCallback / useMemo live in
  // plain .ts modules and exhaustive-deps must run there as well.
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "react-hooks": reactHooksPlugin },
    rules: { ...reactHooksPlugin.configs["recommended-latest"].rules },
  },
];
