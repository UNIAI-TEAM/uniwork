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
  {
    ignores: ["node_modules/", "dist/", ".next/", "out/", ".turbo/"],
  },
];
