import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// A ported file that still says "multica" is a file nobody re-read. The domain
// words are a weaker signal — they appear in ordinary English — so they belong
// in a review pass, not in an assertion.
test("no usf branding survives the port", () => {
  const hits = execSync(
    `grep -ril "multica" packages apps server ` +
      `--include='*.ts' --include='*.tsx' --include='*.go' ` +
      `--include='*.json' --include='*.css' --include='*.mjs' ` +
      `| grep -v node_modules | grep -v '\\.next/' | grep -v tsbuildinfo || true`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `files still referencing usf branding:\n${hits}`);
});
