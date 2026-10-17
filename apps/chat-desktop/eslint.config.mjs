import baseConfig from "@uniwork/eslint-config/base";

export default [
  ...baseConfig,
  { ignores: ["dist/", "coverage/"] },
  // An Electron app ships its runtime from devDependencies (electron-builder
  // bundles them), so main, preload and the electron-vite config may import them.
  {
    files: ["**/*.ts"],
    rules: {
      "import-x/no-extraneous-dependencies": ["error", {
        devDependencies: [
          "**/*.test.ts",
          "src/main/**",
          "src/preload/**",
          "electron.vite.config.ts",
          "vitest.config.ts",
        ],
        peerDependencies: true,
      }],
    },
  },
  // Security: every renderer-controlled URL that reaches the OS shell or the
  // native download system must flow through the safe wrappers in
  // src/main/external-url.ts (scheme allowlist). Enforce it statically so
  // direct shell.openExternal / webContents.downloadURL calls cannot silently
  // regress the protection.
  {
    files: ["src/main/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='shell'][callee.property.name='openExternal']",
          message:
            "Do not call shell.openExternal directly. Use openExternalSafely from './external-url' so the https allowlist stays enforced.",
        },
        {
          selector:
            "CallExpression[callee.object.property.name='webContents'][callee.property.name='downloadURL']",
          message:
            "Do not call webContents.downloadURL directly. Use downloadURLSafely from './external-url' so the https allowlist stays enforced.",
        },
      ],
    },
  },
  {
    files: ["src/main/external-url.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
];
