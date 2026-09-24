import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";

// Hard cutover removed the suite parity flag from product code.
// Docs may still mention the historical flag name.
test("parity flag identifier is gone from apps, packages, and server", () => {
  const needle = ["tasks", "work", "management", "parity"].join("_");
  const hits = execSync(
    `grep -ril "${needle}" apps packages server ` +
      `--include='*.ts' --include='*.tsx' --include='*.go' ` +
      `--include='*.json' --include='*.mjs' --include='*.js' ` +
      `--include='*.yml' --include='*.yaml' --include='*.env*' ` +
      `| grep -v node_modules | grep -v '\\.next/' | grep -v tsbuildinfo || true`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `product paths still reference ${needle}:\n${hits}`);
});
