// FIX-10 (BE review r4, UNI-1380 G7-03a): R4-1 a multi-exit row's note tags no exit; R4-2 an evidence-free FAIL is infra.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-r4.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { blockedAfterFailure, caseResult, expandExits, infraFailureOf, predictedFor, runResult } from "./app-cases-lib.mjs";

const productFail = { name: "exactly_one_commit_post", expected: 1, actual: 2, ok: false };
const pass = { name: "a", expected: 1, actual: 1, ok: true };

/** app-cases.mjs's exit loop, over `blockedAfterFailure`: `outcomes[i]` is what exit i does when it runs. */
function runRow(fq, outcomes) {
  const results = [];
  const ran = [];
  for (const run of expandExits(fq)) {
    const skipped = blockedAfterFailure(run, results);
    if (skipped) {
      results.push(skipped);
      continue;
    }
    ran.push(run.index);
    results.push(runResult({ label: run.label, assertions: outcomes[run.index - 1], predicted: predictedFor(fq, run) }));
  }
  return { results, ran, row: caseResult(fq, results) };
}

// ---- R4-1 -----------------------------------------------------------------------

test("R4-1: a multi-exit row's `predicted FAIL X` note tags none of its exits, so N-1 still blocks after an untagged FAIL", () => {
  const multi = {
    id: "FQ-XX",
    notes: "ready; predicted FAIL OQ-F11 (row-level note)",
    exits: [{ exit: "a -> b" }, { exit: "a -> c" }, { exit: "a -> d" }],
  };
  assert.deepEqual(expandExits(multi).map((run) => predictedFor(multi, run)), [null, null, null]);
  const out = runRow(multi, [[productFail], [pass], [pass]]);
  assert.deepEqual(out.ran, [1], "only the failing exit ran");
  assert.deepEqual(out.results.map((r) => r.result), ["FAIL", "BLOCKED", "BLOCKED"]);
  assert.equal(out.results[0].predicted, undefined);
  assert.equal(out.results[1].blocker, "earlier exit a -> b failed");
  assert.equal(out.row.result, "FAIL");
});

test("R4-1: a per-exit tag on a multi-exit row still applies to that exit only, with the row note present", () => {
  const multi = {
    id: "FQ-XX",
    notes: "predicted FAIL OQ-F11",
    exits: [{ exit: "a -> b", predicted: "OQ-F11" }, { exit: "a -> c" }],
  };
  assert.deepEqual(expandExits(multi).map((run) => predictedFor(multi, run)), ["OQ-F11", null]);
  const out = runRow(multi, [[productFail], [pass]]);
  assert.deepEqual(out.ran, [1, 2], "the tagged exit does not block");
});

test("R4-1: a single-exit row keeps its note tag", () => {
  const single = { id: "FQ-YY", notes: "predicted FAIL F4" };
  assert.equal(predictedFor(single, expandExits(single)[0]), "F4");
});

// ---- R4-2 -----------------------------------------------------------------------

test("R4-2: infraFailureOf names a run with no assertion at all as infra", () => {
  assert.match(infraFailureOf([]), /no assertion/);
  assert.equal(infraFailureOf([pass]), null, "nothing failed");
  assert.equal(infraFailureOf([productFail]), null, "a product failure is not infra");
});

test("R4-2: a predicted exit that FAILs with no assertion is an infra FAIL, carries no tag and blocks the rest of the row", () => {
  const multi = { id: "FQ-XX", exits: [{ exit: "a -> b", predicted: "OQ-F11" }, { exit: "a -> c" }, { exit: "a -> d" }] };
  const out = runRow(multi, [[], [pass], [pass]]);
  assert.equal(out.results[0].result, "FAIL");
  assert.equal(out.results[0].predicted, undefined);
  assert.match(out.results[0].infraFailure, /no assertion/);
  assert.deepEqual(out.ran, [1]);
  assert.deepEqual(out.results.map((r) => r.result), ["FAIL", "BLOCKED", "BLOCKED"]);
  assert.equal(out.row.result, "FAIL");
  assert.match(out.row.infraFailure, /no assertion/);
});

test("R4-2: a BLOCKED run with no assertion stays BLOCKED, with no infraFailure", () => {
  const blocked = runResult({ label: "x", assertions: [], blocker: "no admin" });
  assert.equal(blocked.result, "BLOCKED");
  assert.equal(blocked.infraFailure, undefined);
});
