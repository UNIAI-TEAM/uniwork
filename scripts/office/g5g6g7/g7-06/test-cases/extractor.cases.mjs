// AC-1 cases of the `extractor` check (G7-06 contract 2.2, Amendment 2): a stub
// extractor in a fake fork prints the committed block (green) or a mutated one
// (red: mechanical_column_changed + the manual review row in g6-01-diff.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runExtractorCheck } from "../extractor-check.mjs";
import * as fx from "../test-fixtures/fork-fixtures.mjs";
import { outDir, readJson, tmpDir } from "../test-fixtures/test-env.mjs";


const COMMITTED = fx.committedExtractBlock();

function extractorRun(fork, { name = "extractor", extractor = null } = {}) {
  const dir = outDir(name);
  const check = runExtractorCheck({ forkDir: fork.dir, forkSha: fork.sha, extractor, outDir: dir });
  return { check, artifact: readJson(join(dir, "extractor.json")), diff: readFileSync(join(dir, "g6-01-diff.md"), "utf8") };
}

function stubFork(lines = COMMITTED) {
  return fx.mkFakeFork(tmpDir("g7-06-fork-"), { extractor: fx.stubExtractor(lines) });
}

test("extractor: the committed block is a PASS and the blob sha is recorded", () => {
  const fork = stubFork();
  const { check, artifact } = extractorRun(fork);
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
  assert.equal(artifact.rev.differs, false);
  assert.equal(artifact.counts.committed, artifact.counts.atPin);
  const blob = spawnSync("git", ["-C", fork.dir, "hash-object", "scripts/genoffice-tools-extract.mjs"], { encoding: "utf8" }).stdout.trim();
  assert.equal(artifact.extractor.blobSha, blob);
  assert.match(blob, /^[0-9a-f]{40}$/);
});

test("extractor: one editor_write cell flipped opens the manual review row", () => {
  const flipped = COMMITTED.map((line) => (line.startsWith("| markdown | ask_clarification |") ? line.replace("| no |", "| yes |") : line));
  const { check, diff } = extractorRun(stubFork(flipped), { name: "extractor-flip" });
  assert.equal(check.status, "FAIL");
  assert.deepEqual(check.reasons, ["mechanical_column_changed"]);
  assert.match(diff, /^\| markdown \| ask_clarification \| editor_write \| no \| yes \|$/m);
  assert.match(diff, /^\| markdown\/ask_clarification \| owner F \+ Product \| open \| G7-06 [0-9a-f]+ \| editor_write no -> yes \|$/m);
});

test("extractor: an added row is a mechanical_column_changed with its own review row", () => {
  const added = [...COMMITTED, `| docs | zz_new_tool | ${"0".repeat(64)} | no | apps/docs/src/renderer/ai/tools.ts |`];
  const { check, diff } = extractorRun(stubFork(added), { name: "extractor-add" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons.includes("mechanical_column_changed"));
  assert.match(diff, /^\| docs \| zz_new_tool \| row \| \(absent\) \| added \|$/m);
  assert.match(diff, /^\| docs\/zz_new_tool \| owner F \+ Product \| open \|/m);
});

test("extractor: a removed row is reported too", () => {
  const removed = COMMITTED.filter((line) => !line.startsWith("| docs | accept_changes |"));
  const { check, diff } = extractorRun(stubFork(removed), { name: "extractor-remove" });
  assert.equal(check.status, "FAIL");
  assert.match(diff, /^\| docs \| accept_changes \| row \| removed \| \(absent\) \|$/m);
});

test("extractor: a different rev= alone is not a row difference", () => {
  const otherRev = COMMITTED.map((line, index) => (index === 0 ? line.replace(/rev=[0-9a-f]+/, `rev=${"a".repeat(40)}`) : line));
  const { check, artifact, diff } = extractorRun(stubFork(otherRev), { name: "extractor-rev" });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
  assert.equal(artifact.rev.differs, true);
  assert.match(diff, /rev_differs/);
});

test("extractor: a clean exit with no extract block on stdout is extractor_failed, never PASS", () => {
  // A rev line (or just the header rows) and zero parsed rows compared nothing;
  // PASSing it is the false pass F-01 reports.
  const revOnly = extractorRun(stubFork([COMMITTED[0]]), { name: "extractor-revonly" });
  assert.equal(revOnly.check.status, "FAIL");
  assert.deepEqual(revOnly.check.reasons, ["extractor_failed (no extract block on stdout)"]);
  assert.equal(revOnly.artifact.counts.atPin, 0);

  const headerOnly = extractorRun(stubFork(COMMITTED.slice(0, 3)), { name: "extractor-header" });
  assert.equal(headerOnly.check.status, "FAIL");
  assert.deepEqual(headerOnly.check.reasons, ["extractor_failed (no extract block on stdout)"]);

  const rowsNoRev = extractorRun(stubFork(COMMITTED.slice(1)), { name: "extractor-norev" });
  assert.equal(rowsNoRev.check.status, "FAIL");
  assert.deepEqual(rowsNoRev.check.reasons, ["extractor_failed (no extract block on stdout)"]);
  assert.equal(rowsNoRev.artifact.counts.atPin, rowsNoRev.artifact.counts.committed, "the rows are there, the rev header is not");
});

test("extractor: a failing extractor is extractor_failed with its stderr tail", () => {
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-"), { extractor: fx.failingExtractor("stub: cannot read rev") });
  const { check, artifact } = extractorRun(fork, { name: "extractor-fail" });
  assert.equal(check.status, "FAIL");
  assert.ok(check.reasons[0].startsWith("extractor_failed"), check.reasons.join("; "));
  assert.match(check.reasons[0], /stub: cannot read rev/);
  // a crashed extractor prints no rows: that is not "every row removed"
  assert.equal(check.reasons.length, 1, check.reasons.join("; "));
  assert.deepEqual(artifact.changed, []);
  assert.equal(artifact.exitCode, 1);
});

test("extractor: no fork checkout, no revision or no extractor file is BLOCKED, never a FAIL", () => {
  const noFork = runExtractorCheck({ forkDir: null, forkSha: null, outDir: outDir("extractor-nofork") });
  assert.equal(noFork.status, "BLOCKED");
  assert.deepEqual(noFork.reasons, ["fork_dir_missing", "fork_sha_unresolved"]);
  const fork = fx.mkFakeFork(tmpDir("g7-06-fork-")); // a checkout without the extractor (an old fork tree)
  const dir = outDir("extractor-noscript");
  const noScript = runExtractorCheck({ forkDir: fork.dir, forkSha: fork.sha, outDir: dir });
  assert.equal(noScript.status, "BLOCKED");
  assert.match(noScript.reasons[0], /^extractor_missing \(.*genoffice-tools-extract\.mjs\)$/);
  assert.equal(readJson(join(dir, "extractor.json")).verdict.status, "BLOCKED");
});
