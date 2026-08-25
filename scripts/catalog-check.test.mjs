import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Every package the tier-1 port will need. Sourced from usf's
// packages/ui/package.json and packages/core/package.json. Keep this list in
// sync with the plan — it is the only reason versions cannot drift between
// sweep batches.
const REQUIRED = [
  "zustand",
  "@tanstack/react-table",
  "@tanstack/react-virtual",
  "@testing-library/user-event",
  "@formatjs/intl-localematcher",
  "eslint-plugin-i18next",
  "katex",
  "rehype-katex",
  "remark-math",
  "posthog-js",
  "react-virtuoso",
  "unicode-animations",
];

test("pnpm catalog declares every shared dependency the port needs", () => {
  const yaml = readFileSync("pnpm-workspace.yaml", "utf8");
  const missing = REQUIRED.filter((name) => {
    const key = name.startsWith("@") ? `"${name}":` : `${name}:`;
    return !yaml.includes(key);
  });
  assert.deepEqual(missing, [], `missing from catalog: ${missing.join(", ")}`);
});
