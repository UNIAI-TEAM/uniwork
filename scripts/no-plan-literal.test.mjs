import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// Spec F-02 §2 #2: code asks Can(feature) / CheckQuota(meter); the plan
// decides. A plan code in a branch is a pricing decision hidden in code, so
// the common plan names may not appear as string literals outside the
// billing package, migrations (the seed) and tests. Swagger examples in
// struct tags are documentation, not branches. The reserved-slug list is
// generated, and a line that names a route or a UI key rather than a plan says
// so with `plan-literal-ok: <why>`.
test("no plan code literal outside the billing package", () => {
  const hits = execSync(
    `grep -rnE '"(starter|team|business|enterprise|pro|free)"' server packages apps ` +
      `--include='*.go' --include='*.ts' --include='*.tsx' ` +
      `| grep -v node_modules | grep -v '\\.next/' | grep -v '/generated/' ` +
      `| grep -v '_test\\.go' | grep -v '\\.test\\.ts' ` +
      `| grep -v 'server/internal/billing/' | grep -v 'example:"' ` +
      `| grep -v 'packages/core/paths/reserved-slugs\\.ts' | grep -v 'plan-literal-ok' || true`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `plan codes hard-coded outside billing:\n${hits}`);
});
