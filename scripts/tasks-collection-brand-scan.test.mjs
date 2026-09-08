import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const roots = ["packages/views/tasks", "packages/views/my-tasks"];

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.name === ".gitkeep") continue;
    else if (/\.(tsx?|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("collection UI has no source brand or Issue domain", async () => {
  const files = (await Promise.all(roots.map((r) => walk(r)))).flat();
  assert.ok(files.length > 0, "expected suite files under tasks/ or my-tasks/");
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.equal(/multica/i.test(text), false, file);
    assert.equal(/@multica\//.test(text), false, file);
    assert.equal(/\bIssue\b/.test(text), false, file);
    assert.equal(/\bIssues\b/.test(text), false, file);
  }
});
