import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("../docs/parity/tasks-work-management.json", import.meta.url);

test("Tasks parity manifest pins and classifies the complete baseline", async () => {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.baseline_commit, "3d37828e9");
  assert.ok(manifest.entries.length >= 709);

  const sources = manifest.entries.map((entry) => entry.source_path);
  assert.equal(new Set(sources).size, sources.length);
  for (const entry of manifest.entries) {
    assert.match(entry.source_path, /\S/);
    assert.match(entry.target_path, /\S/);
    assert.equal(entry.target_path.toLowerCase().includes(manifest.source_product.toLowerCase()), false);
    assert.ok(["source", "route", "test", "locale", "capability"].includes(entry.kind));
    assert.ok(["ported", "adapted", "stubbed"].includes(entry.disposition));
    assert.ok(["pending", "verified"].includes(entry.verification_state));
    assert.equal(entry.owner_issue, "UNI-426");
  }

  for (const route of [
    "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/my-issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/projects/page.tsx",
  ]) {
    assert.ok(sources.includes(route), `missing route ${route}`);
  }
  assert.equal(manifest.entries.some((entry) => entry.disposition === "stubbed"), true);
});
