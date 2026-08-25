import nextConfig from "@uniwork/eslint-config/next";

export default [
  ...nextConfig,
  { ignores: [".next/", ".turbo/"] },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: { "react/display-name": "off" },
  },
];
