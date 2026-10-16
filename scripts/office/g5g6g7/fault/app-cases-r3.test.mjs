// FIX-9 (BE review r3, UNI-1380 G7-03a): R3-1 N-1 does not wall off the exits after a predicted FAIL.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-r3.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { blockedAfterFailure, caseResult, expandExits, predictedFor, runResult } from "./app-cases-lib.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const doc = loadFaultCases();
const row = (id) => doc.cases.find((r) => r.id === id);
const productFail = { name: "exactly_one_commit_post", expected: 1, actual: 2, ok: false };
const infraFail = { name: "run_execution", expected: "no unhandled error", actual: "fetch failed", ok: false };
const pass = { name: "a", expected: 1, actual: 1, ok: true };

/** FQ-40 with one exit's predicted tag removed (index list), or all of them: the N-1 rule is tested on an untagged exit. */
const withoutTags = (fq, which = null) => ({ ...fq, exits: fq.exits.map(({ predicted, ...e }, i) => (which && !which.includes(i) ? { ...e, predicted } : e)) });

/** app-cases.mjs's exit loop, over `blockedAfterFailure`: `outcomes[i]` is what exit i does when it runs. */
function runRow(fq, outcomes) {
  const runs = expandExits(fq);
  const results = [];
  const ran = [];
  for (const run of runs) {
    const skipped = blockedAfterFailure(run, results);
    if (skipped) {
      results.push(skipped);
      continue;
    }
    ran.push(run.index);
    results.push(runResult({ label: run.label, assertions: outcomes[run.index - 1], predicted: predictedFor(fq, run) }));
  }
  return { runs, results, ran, row: caseResult(fq, results) };
}

// ---- R3-1 -----------------------------------------------------------------------

test("R3-1: FQ-40 exit 1 is a predicted FAIL (OQ-F11): exits 2..5 still run, and the row stays FAIL", () => {
  const fq40 = row("FQ-40");
  const runs = expandExits(fq40);
  assert.ok(runs.length >= 5, "FQ-40 has the five reconciling exits");
  assert.equal(predictedFor(fq40, runs[0]), "OQ-F11", "the first exit is the predicted one");
  assert.equal(predictedFor(fq40, runs[1]), "OQ-F11", "every exit is, since Advisor qa-fault_local:23");
  const out = runRow(fq40, runs.map((_, i) => (i === 0 ? [productFail] : [pass])));
  assert.deepEqual(out.ran, runs.map((r) => r.index), "every exit ran");
  assert.deepEqual(out.results.map((r) => r.result), ["FAIL", ...runs.slice(1).map(() => "PASS")]);
  assert.equal(out.results[0].predicted, "OQ-F11");
  assert.equal(out.row.result, "FAIL", "a later PASS never turns the row PASS");
  assert.equal(out.row.exits.length, runs.length);
  assert.equal(out.row.blocker, undefined, "nothing was blocked");
});

test("R3-1: a predicted FAIL followed by a non-predicted FAIL blocks what comes after the second", () => {
  const fq40 = withoutTags(row("FQ-40"), [1]);
  const runs = expandExits(fq40);
  const out = runRow(fq40, runs.map((_, i) => (i === 0 || i === 1 ? [productFail] : [pass])));
  assert.deepEqual(out.ran, [1, 2], "exit 2 ran after the predicted FAIL, then the wall");
  assert.deepEqual(out.results.map((r) => r.result), ["FAIL", "FAIL", ...runs.slice(2).map(() => "BLOCKED")]);
  assert.equal(out.results[2].blocker, `earlier exit ${runs[1].label} failed`);
  assert.equal(out.row.result, "FAIL");
});

test("R3-1: a non-predicted FAIL first blocks every later exit of FQ-40, and the row is FAIL", () => {
  const fq40 = row("FQ-40");
  const runs = expandExits(fq40);
  // the tag is per exit: with it removed from the first exit, that exit failing is the unowned FAIL
  const untagged = withoutTags(fq40, [0]);
  const rr = expandExits(untagged);
  assert.equal(predictedFor(untagged, rr[0]), null);
  const out = runRow(untagged, rr.map((_, i) => (i === 0 ? [productFail] : [pass])));
  assert.deepEqual(out.ran, [1], "only the failing exit ran");
  assert.deepEqual(out.results.map((r) => r.result), ["FAIL", ...runs.slice(1).map(() => "BLOCKED")]);
  assert.equal(out.results[0].predicted, undefined);
  for (const blocked of out.results.slice(1)) assert.equal(blocked.blocker, `earlier exit ${rr[0].label} failed`);
  assert.equal(out.row.result, "FAIL");
});

test("R3-1: an infra FAIL on a predicted exit still blocks the rest (runResult drops the tag from it)", () => {
  const fq40 = row("FQ-40");
  const runs = expandExits(fq40);
  const out = runRow(fq40, runs.map((_, i) => (i === 0 ? [infraFail] : [pass])));
  assert.equal(out.results[0].predicted, undefined);
  assert.match(out.results[0].infraFailure, /^run_execution/);
  assert.deepEqual(out.ran, [1]);
  assert.equal(out.row.result, "FAIL");
});
