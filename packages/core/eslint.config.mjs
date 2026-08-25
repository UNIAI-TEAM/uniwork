import reactConfig from "@uniwork/eslint-config/react";

export default [
  ...reactConfig,
  // Package boundary: core is headless. It runs under Node in tests and on
  // non-browser platforms, so browser globals and build-time env reads must be
  // injected through the platform adapters rather than reached for directly.
  {
    files: ["**/*.{ts,tsx}"],
    // platform/ is the adapter layer itself: forbidding it from touching
    // localStorage would forbid implementing the very abstraction the rule
    // makes everything else use.
    ignores: ["**/*.test.{ts,tsx}", "test/**", "platform/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["react-dom", "react-dom/*"],
          message:
            "packages/core is headless. Rendering belongs in packages/ui or packages/views.",
        }],
      }],
      "no-restricted-globals": ["error",
        {
          name: "localStorage",
          message:
            "packages/core must use StorageAdapter from ./platform — localStorage does not exist in Node tests or on every platform.",
        },
        {
          name: "sessionStorage",
          message:
            "packages/core must use StorageAdapter from ./platform.",
        },
      ],
      "no-restricted-syntax": ["error", {
        // Matches the `process.env` node itself, so every read is caught, not
        // just `process.env.X` property access.
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message:
          "packages/core must not read process.env. Inject configuration through the platform layer.",
      }],
    },
  },
];
