import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const roots = [
  "packages/views/squads",
  "packages/views/runtimes",
  "packages/views/tasks/detail",
  "packages/views/tasks/surface",
  "packages/views/common",
  "apps/web/app/[orgSlug]/[workspaceSlug]/squads",
  "apps/web/app/[orgSlug]/[workspaceSlug]/runtimes",
];
const LOCALE_FILES = [
  "packages/core/i18n/locales/en.json",
  "packages/core/i18n/locales/vi.json",
];
/** Product keys introduced for slice 6 — scan values only, not the whole catalogue. */
const LOCALE_PREFIXES = [
  "squads",
  "runtimes",
  "nav.squads",
  "nav.runtimes",
  "tasks.detail.agentRun",
  "tasks.detail.pullRequests",
  "tasks.detail.agent_run",
  "tasks.detail.pr_",
  "tasks.surface.agent_trigger",
  "tasks.surface.squad_assign",
  "tasks.surface.agent_chip_stub",
  "tasks.surface.vcs_chip_stub",
  "tasks.batch.agent_trigger",
  "tasks.batch.squad_assign",
  "capabilities.agent_runtime_missing",
  "capabilities.squad_directory_missing",
  "capabilities.vcs_provider_missing",
  "capabilities.local_daemon_missing",
];

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

function flattenLocale(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flattenLocale(v, key, out);
  }
  return out;
}

function sliceLocaleValues(raw) {
  const flat = flattenLocale(JSON.parse(raw));
  return Object.entries(flat)
    .filter(([key]) =>
      LOCALE_PREFIXES.some((p) => key === p || key.startsWith(`${p}.`)),
    )
    .map(([, value]) => value)
    .join("\n");
}

test("slice 6 locale strings have no source brand or Issue domain", async () => {
  for (const file of LOCALE_FILES) {
    const text = await readFile(file, "utf8");
    const values = sliceLocaleValues(text);
    assert.ok(values.length > 0, `${file}: expected slice-6 locale keys`);
    for (const re of BRAND_BAD) assertNoMatch(file, values, re);
  }
});

test("agent integration suite UI has no source brand or Issue domain", async () => {
  const files = (await Promise.all(roots.map((r) => walk(r)))).flat();
  assert.ok(files.length > 0, "expected agent integration view files");
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const re of BRAND_BAD) assertNoMatch(file, text, re);
    for (const re of DOMAIN_BAD) assertNoMatch(file, text, re);
    assertNoIssuesPath(file, text);
  }
});
