import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Spec F-02 §2 #2: code asks Can(feature) / CheckQuota(meter); the plan
// decides. A plan code in a branch is a pricing decision hidden in code, so
// the common plan names may not appear as string literals outside the
// billing package, migrations (the seed) and tests. Swagger examples in
// struct tags are documentation, not branches. The reserved-slug list is
// generated, and a line that names a route or a UI key rather than a plan says
// so with `plan-literal-ok: <why>`.
//
// Walks the tree in Node rather than shelling out to grep, so it runs the same
// under cmd.exe on Windows as on the Linux CI runner.
const PLAN_LITERAL = /"(starter|team|business|enterprise|pro|free)"/;
const SOURCE = /\.(go|ts|tsx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "generated", ".git"]);
const EXCLUDE = [
  "node_modules",
  ".next/",
  "/generated/",
  "_test.go",
  ".test.ts",
  "server/internal/billing/",
  'example:"',
  "packages/core/paths/reserved-slugs.ts",
  "plan-literal-ok",
];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(path);
    } else if (SOURCE.test(entry.name)) {
      yield path;
    }
  }
}

test("no plan code literal outside the billing package", () => {
  const hits = [];
  for (const root of ["server", "packages", "apps"]) {
    for (const path of sourceFiles(root)) {
      readFileSync(join(path), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!PLAN_LITERAL.test(line)) return;
          // Matched against the whole `path:line:text` hit, as the grep
          // pipeline this replaces filtered it.
          const hit = `${path}:${i + 1}:${line}`;
          if (!EXCLUDE.some((part) => hit.includes(part))) hits.push(hit);
        });
    }
  }
  assert.equal(hits.join("\n"), "", `plan codes hard-coded outside billing:\n${hits.join("\n")}`);
});
