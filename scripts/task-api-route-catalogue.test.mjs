import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("../docs/parity/tasks-api-client-core-routes.json", import.meta.url);

test("slice-2 route catalogue pins Work Management API surface", async () => {
  const cat = JSON.parse(await readFile(path, "utf8"));
  assert.equal(cat.schema_version, 1);
  assert.equal(cat.baseline_commit, "3d37828e9");
  assert.ok(cat.routes.length >= 40);
  const keys = cat.routes.map((r) => `${r.method} ${r.target_path}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const r of cat.routes) {
    assert.match(r.target_path, /^\/api\/v1\//);
    assert.equal(r.target_path.toLowerCase().includes("multica"), false);
    assert.equal(r.target_path.toLowerCase().includes("/issues"), false);
    assert.ok(["tasks", "my_tasks", "table", "catalog", "views", "projects", "collaboration", "stub"].includes(r.group));
    assert.ok(["ported", "adapted", "stubbed"].includes(r.disposition));
  }
  const groups = new Set(cat.routes.map((r) => r.group));
  for (const g of ["tasks", "table", "catalog", "views", "projects", "collaboration"]) {
    assert.ok(groups.has(g), `missing group ${g}`);
  }
});
