import reactConfig from "@uniwork/eslint-config/react";

export default [
  ...reactConfig,
  // Package boundary: ui holds atomic primitives with zero business logic.
  // Importing core would make every primitive drag the API client, the stores
  // and the domain types along with it.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "test/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@uniwork/core", "@uniwork/core/*"],
          message:
            "packages/ui must not depend on business logic. Pass data in through props instead.",
        }],
      }],
    },
  },
];
