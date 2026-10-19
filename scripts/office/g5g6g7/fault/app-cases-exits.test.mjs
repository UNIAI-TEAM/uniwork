// FIX-15 (UNI-1380 G7-03a): the `--exits a-b` slice of the app runner - parsing,
// the skipped-exit line, and the rule that a sliced row never reports PASS.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-exits.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAppCasesArgs } from "./app-cases.mjs";
import { BLOCKED_EXIT_CODE, expandExits, runResult } from "./app-cases-lib.mjs";
import { EXTRA_EXITS } from "./app-case-drivers-blocked.mjs";
import {
  ExitRangeError, parseExitRange, partialCaseResult, partialLabel, selectExitRange, skippedExitLine,
} from "./app-cases-exits.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const row = (id) => loadFaultCases().cases.find((r) => r.id === id);
/** The runs app-cases.mjs makes for a row: its exits, then the driver's extra exits. */
const runs = (id) => {
  const found = row(id);
  return [...expandExits(found), ...(EXTRA_EXITS[id] ?? []).map((exit, i) => ({ index: (found.exits?.length ?? 0) + i + 1, label: exit.exit, exit }))];
};
const pass = { name: "a", ok: true };
const fail = { name: "b", ok: false };

test("parseExitRange reads a-b and n, and refuses everything else", () => {
  assert.deepEqual(parseExitRange("1-3"), { from: 1, to: 3, label: "1-3" });
  assert.deepEqual(parseExitRange(" 4 "), { from: 4, to: 4, label: "4-4" });
  assert.deepEqual(parseExitRange("2-2"), { from: 2, to: 2, label: "2-2" });
  for (const bad of ["", "0", "0-2", "3-1", "a", "1-", "-2", "1..3", "1-2-3"]) {
    assert.throws(() => parseExitRange(bad), ExitRangeError, `"${bad}" should be refused`);
  }
});

test("selectExitRange keeps the range and skips the rest, numbering by position", () => {
  const fq50 = runs("FQ-50");
  assert.equal(fq50.length, 5);
  assert.deepEqual(selectExitRange(fq50, null), { ran: fq50, skipped: [] });
  const slice = selectExitRange(fq50, parseExitRange("2-4"), "FQ-50");
  assert.deepEqual(slice.ran.map((r) => r.index), [2, 3, 4]);
  assert.deepEqual(slice.skipped.map((r) => r.index), [1, 5]);
  // a single-exit row lists no exits array (index 0): `--exits 1` is its whole row
  const fq22 = runs("FQ-22");
  assert.deepEqual(fq22.map((r) => r.index), [0]);
  assert.deepEqual(selectExitRange(fq22, parseExitRange("1"), "FQ-22").ran, fq22);
  assert.deepEqual(selectExitRange(fq22, parseExitRange("1-2"), "FQ-22").skipped, []);
  assert.throws(() => selectExitRange(fq22, parseExitRange("2"), "FQ-22"), ExitRangeError);
  assert.throws(() => selectExitRange(fq50, parseExitRange("6"), "FQ-50"), ExitRangeError);
});

test("a skipped exit prints its own line, never a verdict", () => {
  const fq43 = runs("FQ-43");
  const line = skippedExitLine("FQ-43", fq43[3], fq43.length, parseExitRange("1-3"));
  assert.equal(line, `FQ-43 [4/9] ${fq43[3].label}: SKIPPED - outside --exits 1-3`);
  assert.match(line, /SKIPPED - outside --exits 1-3$/);
  assert.equal(partialLabel(parseExitRange("1-3"), 9), "partial 1-3 of 9");
});

test("a sliced row is never PASS: the worst of the exits it ran, with exitRange recorded", () => {
  const fq50 = runs("FQ-50");
  const slice = selectExitRange(fq50, parseExitRange("1-2"), "FQ-50");
  const row = { id: "FQ-50", ac: ["G5-A08"], fixture: "fx-xlsx-revenue-xyz" };
  const passed = partialCaseResult(runResult({ label: "a", assertions: [pass] }), { range: parseExitRange("1-2"), total: 5, skipped: slice.skipped });
  assert.equal(passed.result, "BLOCKED");
  assert.equal(passed.blocker, "partial 1-2 of 5: exit(s) 3, 4, 5 not run");
  assert.deepEqual(passed.exitRange, { from: 1, to: 2, of: 5, skipped: [3, 4, 5] });
  const failed = partialCaseResult(runResult({ label: "a", assertions: [fail], predicted: "OQ-F11" }), { range: parseExitRange("1-2"), total: 5, skipped: slice.skipped });
  assert.equal(failed.result, "FAIL", "a FAIL keeps its own verdict");
  assert.equal(failed.predicted, "OQ-F11");
  assert.equal(failed.blocker, undefined);
  const blocked = partialCaseResult(runResult({ label: "a", assertions: [pass], blocker: "harness server down" }), { range: parseExitRange("3"), total: 5, skipped: [fq50[0], fq50[1], fq50[3], fq50[4]] });
  assert.equal(blocked.result, "BLOCKED");
  assert.equal(blocked.blocker, "harness server down; partial 3-3 of 5: exit(s) 1, 2, 4, 5 not run");
  assert.equal(row.id, "FQ-50", "the row itself is untouched");
});

test("without --exits nothing changes: every exit runs and no result is rewritten", () => {
  const whole = runResult({ label: "a", assertions: [pass] });
  assert.equal(partialCaseResult(whole, { range: null, total: 3, skipped: [] }), whole);
  const full = selectExitRange(runs("FQ-43"), null);
  assert.equal(full.ran.length, 9, "the six table exits and the three real-condition runs");
  assert.equal(full.skipped.length, 0);
  // a range that covers the whole row skips nothing: it records itself only
  const covered = partialCaseResult(runResult({ label: "a", assertions: [pass] }), { range: parseExitRange("1-3"), total: 3, skipped: [] });
  assert.equal(covered.result, "PASS");
  assert.deepEqual(covered.exitRange, { from: 1, to: 3, of: 3, skipped: [] });
});

// ---- the CLI, run for real (no harness: a pending row is BLOCKED, and a bad
// range is a usage error before anything runs) ------------------------------------
const runCli = (args) => spawnSync(process.execPath, [join(FAULT_DIR, "app-cases.mjs"), ...args], {
  encoding: "utf8", env: { ...process.env, OFFICE_EVIDENCE_ID: "ev-unit-test", HARNESS_RUN_DIR: "" },
});

test("parseAppCasesArgs reads --exits and refuses it without --case", () => {
  const args = parseAppCasesArgs(["--case", "FQ-43", "--exits", "1-3"], {});
  assert.deepEqual(args.exits, { from: 1, to: 3, label: "1-3" });
  assert.deepEqual(parseAppCasesArgs(["--case", "FQ-43", "--exits=4"], {}).exits, { from: 4, to: 4, label: "4-4" });
  assert.deepEqual(parseAppCasesArgs(["--case", "FQ-43", "--exits", "9"], {}).exits, { from: 9, to: 9, label: "9-9" });
  assert.equal(parseAppCasesArgs(["--case", "FQ-43"], {}).exits, null);
  assert.throws(() => parseAppCasesArgs(["--exits", "1-3"], {}), ExitRangeError);
  assert.throws(() => parseAppCasesArgs(["--case", "FQ-43", "--exits", "3-1"], {}), ExitRangeError);
  assert.throws(() => parseAppCasesArgs(["--case", "FQ-43", "--exits"], {}), ExitRangeError);
  // an unknown flag stays the plain error it always was
  assert.throws(() => parseAppCasesArgs(["--bogus"], {}), /unknown argument/);
});

test("app-cases.mjs --exits: a bad range exits 2, and a pending row still reports BLOCKED", () => {
  const runDir = mkdtempSync(join(tmpdir(), "fault-exits-cli-"));
  try {
    for (const args of [["--exits", "1-3"], ["--case", "FQ-23", "--exits", "3-1"], ["--case", "FQ-23", "--exits", "0"], ["--case", "FQ-22", "--exits", "9"]]) {
      const run = runCli([...args, "--run-dir", runDir]);
      assert.equal(run.status, 2, `${args.join(" ")}: ${run.stderr}`);
      assert.match(run.stderr, /^app-cases\.mjs: --exits/);
      assert.equal(existsSync(join(runDir, "fault", "FQ-22", "result.json")), false, "a usage error runs nothing");
      assert.equal(existsSync(join(runDir, "fault", "FQ-23", "result.json")), false, "a usage error runs nothing");
    }
    const blocked = runCli(["--case", "FQ-23", "--exits", "1", "--run-dir", runDir]);
    assert.equal(blocked.status, BLOCKED_EXIT_CODE, blocked.stderr);
    const result = JSON.parse(readFileSync(join(runDir, "fault", "FQ-23", "result.json"), "utf8"));
    assert.equal(result.result, "BLOCKED");
    assert.equal(result.exitRange, undefined, "a row that never ran has no slice");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
