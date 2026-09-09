import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const roots = ["packages/views/editor", "packages/views/tasks/detail"];

/** Capital brand leftovers — always fail (product + tests). */
const BRAND_BAD = [/multica/i, /@multica\//, /\bIssue\b/, /\bIssues\b/];

/**
 * Product Issue-domain leftovers. Applied to every file; `/issues/` matches
 * are skipped when the same line mentions github.com (external URL tests).
 */
const DOMAIN_BAD = [
  /\bmy-issues\b/,
  /\bissueKeys\b/,
  /kind:\s*"issue"/,
  /resolveIssueIdentifier/,
  /flattenIssueBuckets/,
];

const ISSUES_PATH = /\/issues\//;

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

function assertNoMatch(file, text, re) {
  assert.equal(re.test(text), false, `${file} matched ${re}`);
}

function assertNoIssuesPath(file, text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ISSUES_PATH.test(line)) continue;
    if (/github\.com/i.test(line)) continue;
    assert.fail(`${file}:${i + 1} matched /\\/issues\\// (non-GitHub)`);
  }
}

test("task detail suite UI has no source brand or Issue domain", async () => {
  const files = (await Promise.all(roots.map((r) => walk(r)))).flat();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const re of BRAND_BAD) assertNoMatch(file, text, re);
    for (const re of DOMAIN_BAD) assertNoMatch(file, text, re);
    assertNoIssuesPath(file, text);
  }
});
