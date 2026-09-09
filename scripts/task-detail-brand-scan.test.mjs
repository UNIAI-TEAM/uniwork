import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const roots = ["packages/views/editor", "packages/views/tasks/detail"];

const BAD = [/multica/i, /@multica\//, /\bIssue\b/, /\bIssues\b/];

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
    else if (/\.(tsx?|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("task detail suite UI has no source brand or Issue domain", async () => {
  const files = (await Promise.all(roots.map((r) => walk(r)))).flat();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const re of BAD) {
      assert.equal(re.test(text), false, `${file} matched ${re}`);
    }
  }
});
