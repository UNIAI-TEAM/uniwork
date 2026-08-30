import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

/** @type {import("eslint").Linter.Config[]} */
export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      // Already enforced by the TypeScript compiler
      // (noUnusedLocals / noUnusedParameters).
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // A package may only import what its own package.json declares.
      //
      // Under pnpm's strict node_modules layout an undeclared package does not
      // resolve at all, so tsc already rejects it and this rule stays silent —
      // it only reports imports that DO resolve. What it actually catches is
      // the case neither pnpm nor tsc does: production code importing a
      // devDependency. That ships fine in the monorepo and breaks for any
      // consumer installing the package without dev deps.
      "import-x/no-extraneous-dependencies": ["error", {
        devDependencies: [
          "**/*.test.{ts,tsx}",
          "**/*.spec.{ts,tsx}",
          "**/test/**",
          "**/tests/**",
          "**/vitest.config.*",
          "**/vite.config.*",
          "**/eslint.config.*",
          "**/scripts/**",
        ],
        peerDependencies: true,
      }],
    },
  },
  // Type-aware: a promise that nobody awaits, `void`s or `.catch`es is a
  // silent failure at runtime. `void p` is the explicit opt-out.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.config.*", "**/scripts/**"],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // JSX handlers and option-object callbacks (onSubmit, onSuccess) are
      // conventionally async in React / TanStack; plain function arguments
      // (addEventListener, emitter.on, forEach) are not and stay checked.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false, properties: false } }],
    },
  },
  // A file past this size is two modules sharing a name. Registry copies
  // (packages/ui/components/ui) and tests are exempt: the first are vendored
  // as-is, the second grow with the cases they pin.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/components/ui/**", "**/*.test.{ts,tsx}"],
    rules: { "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }] },
  },
  {
    ignores: ["node_modules/", "dist/", ".next/", "out/", ".turbo/"],
  },
];
