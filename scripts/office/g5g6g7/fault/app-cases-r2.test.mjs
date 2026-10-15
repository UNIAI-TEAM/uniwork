// FIX-7 (BE review r2, UNI-1380 G7-03a): R2-1 infra FAIL is never predicted, R2-5 the cause clause once,
// R2-6 the precondition names the origin it probed and maps every loopback form, N-1 an exit after a FAIL is BLOCKED.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-r2.test.mjs
import assert from "node:assert/strict";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";
import {
  blockedAfterFailure, caseResult, expandExits, infraFailureOf, noServerReason, predictedFor, runResult,
} from "./app-cases-lib.mjs";
import { guardCaseResult } from "./app-process-guard.mjs";
import { TenantError, causeSuffix, dRequest, errorText, runnerApiOrigin, seedAccount } from "./app-tenant.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const rows = loadFaultCases().cases;
const row = (id) => rows.find((r) => r.id === id);
const UNREACHABLE = "create file document: POST /api/v1/files -> unreachable (fetch failed; cause ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8080 127.0.0.1:8080)";
const infraAssertion = { name: "run_execution", expected: "no unhandled error", actual: UNREACHABLE, ok: false };
const productFail = { name: "exactly_one_commit_post", expected: 1, actual: 2, ok: false };

// ---- R2-1 -----------------------------------------------------------------------

test("R2-1: a run whose only failure is run_execution (unreachable) is a FAIL with infraFailure and never predicted", () => {
  const fq22 = row("FQ-22");
  const [run] = expandExits(fq22);
  assert.equal(predictedFor(fq22, run), "OQ-F11", "the row is tagged, so the tag is on offer to every run");
  const result = runResult({ label: run.label, assertions: [infraAssertion], predicted: predictedFor(fq22, run) });
  assert.equal(result.result, "FAIL");
  assert.equal(result.predicted, undefined);
  assert.match(result.infraFailure, /^run_execution: .*unreachable \(fetch failed; cause ECONNREFUSED/);
  const rowResult = caseResult(fq22, [result]);
  assert.equal(rowResult.result, "FAIL");
  assert.equal(rowResult.predicted, undefined, "case-result.json does not count a runner failure as a predicted product failure");
  assert.match(rowResult.infraFailure, /run_execution/);
  assert.match(rowResult.exits[0].infraFailure, /run_execution/);
});

test("R2-1: a product assertion FAIL on FQ-22 is still predicted OQ-F11 and carries no infraFailure", () => {
  const fq22 = row("FQ-22");
  const [run] = expandExits(fq22);
  const result = runResult({ label: run.label, assertions: [{ name: "ok", ok: true }, productFail], predicted: predictedFor(fq22, run) });
  assert.equal(result.predicted, "OQ-F11");
  assert.equal(result.infraFailure, undefined);
  const rowResult = caseResult(fq22, [result]);
  assert.deepEqual([rowResult.result, rowResult.predicted, rowResult.infraFailure], ["FAIL", "OQ-F11", undefined]);
});

test("R2-1: a run with both a product and an infra failure is a product FAIL (the tag stays); harness_started is infra too", () => {
  const mixed = runResult({ label: "a", assertions: [productFail, infraAssertion], predicted: "F4" });
  assert.equal(mixed.predicted, "F4");
  assert.equal(mixed.infraFailure, undefined);
  const harness = runResult({ assertions: [{ name: "harness_started", expected: "start.sh up", actual: "start.sh failed", ok: false }], predicted: "F4" });
  assert.deepEqual([harness.result, harness.predicted, harness.infraFailure], ["FAIL", undefined, "harness_started: start.sh failed"]);
  assert.equal(infraFailureOf([{ name: "x", ok: true }]), null, "nothing failed");
  assert.match(infraFailureOf([]), /no assertion/, "a run that proved nothing is infra (review r4 R4-2)");
});

test("R2-1: an unpredicted infra FAIL does not hide another run's predicted FAIL tag, nor the reverse", () => {
  const fq40 = row("FQ-40");
  const predicted = runResult({ label: "a", assertions: [productFail], predicted: "OQ-F11" });
  const infra = runResult({ label: "b", assertions: [infraAssertion], predicted: "OQ-F11" });
  const result = caseResult(fq40, [predicted, infra]);
  assert.equal(result.predicted, undefined, "one run was a runner failure, so the row is not a predicted product FAIL");
  assert.match(result.infraFailure, /^b: run_execution/);
});

test("R2-1: a BLOCKED row has no infraFailure and the harness guard keeps none on a BLOCKED row", () => {
  const blocked = runResult({ label: "a", blocker: "harness down", assertions: [infraAssertion] });
  assert.deepEqual([blocked.result, blocked.infraFailure], ["BLOCKED", undefined]);
  const guarded = guardCaseResult(caseResult(row("FQ-22"), [runResult({ label: "a", assertions: [infraAssertion] })]), "harness server down", { complete: true });
  assert.equal(guarded.result, "BLOCKED");
  assert.equal(guarded.predicted, undefined);
});

// ---- R2-5 -----------------------------------------------------------------------

const occurrences = (text, needle) => text.split(needle).length - 1;

test("R2-5: run_execution.actual carries the cause clause once for an unreachable TenantError", async () => {
  const srv = createTcpServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  const error = await seedAccount(`http://127.0.0.1:${port}`, "r2").then(() => null, (e) => e);
  assert.ok(error instanceof TenantError, "the closed port surfaces as a TenantError from the tenant seed");
  assert.equal(occurrences(error.message, "cause ECONNREFUSED"), 1, "the thrower appends the clause once");
  const text = errorText(error);
  assert.equal(text, error.message, "the catch-all adds nothing to a TenantError");
  assert.equal(occurrences(text, "fetch failed"), 1);
  assert.equal(occurrences(text, "cause "), 1);
});

test("R2-5: an Error that is not a TenantError gets its fetch cause once, a plain Error nothing", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED", address: "127.0.0.1", port: 9 });
  const fetchError = new TypeError("fetch failed", { cause });
  const text = errorText(fetchError);
  assert.equal(occurrences(text, "fetch failed"), 1);
  assert.equal(occurrences(text, "cause ECONNREFUSED"), 1);
  assert.match(text, /127\.0\.0\.1:9\)$/);
  assert.equal(errorText(new Error("boom")), "boom");
  assert.equal(errorText("text"), "text");
  const res = await dRequest("http://127.0.0.1:1", "/x");
  assert.equal(res.status, "unreachable");
  assert.equal(occurrences(causeSuffix(res), "cause "), 1, "the unreachable result's own suffix is unchanged");
});

// ---- R2-6 -----------------------------------------------------------------------

test("R2-6: runnerApiOrigin maps localhost, [::1] and bare ::1 to the IPv4 loopback and leaves other hosts alone", () => {
  const mapped = {
    "http://localhost:8080": "http://127.0.0.1:8080",
    "https://localhost:8443": "https://127.0.0.1:8443",
    "http://[::1]:8080": "http://127.0.0.1:8080",
    "https://[::1]:8443": "https://127.0.0.1:8443",
    "http://[::1]": "http://127.0.0.1",
    "::1": "http://127.0.0.1",
    "[::1]:8080": "http://127.0.0.1:8080",
    "localhost:8080": "http://127.0.0.1:8080",
    "http://127.0.0.1:8080": "http://127.0.0.1:8080",
    "http://api.example.com:8080": "http://api.example.com:8080",
    "http://localhost.example.com:8080": "http://localhost.example.com:8080",
    "http://[2001:db8::1]:8080": "http://[2001:db8::1]:8080",
    "not a url": "not a url",
  };
  for (const [input, expected] of Object.entries(mapped)) assert.equal(runnerApiOrigin(input), expected, input);
});

test("R2-6: the precondition reason names the origin it probed, and the published API_ORIGIN when it differs", () => {
  const probed = runnerApiOrigin("http://localhost:8080");
  const reason = noServerReason({ probed, apiOrigin: "http://localhost:8080", error: "fetch failed (cause ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8080)" });
  assert.match(reason, /^no D server on http:\/\/127\.0\.0\.1:8080 \(API_ORIGIN http:\/\/localhost:8080\): fetch failed/);
  assert.equal(noServerReason({ probed: "http://127.0.0.1:8080", apiOrigin: "http://127.0.0.1:8080" }), "no D server on http://127.0.0.1:8080");
});

// ---- N-1 ------------------------------------------------------------------------

test("N-1: after an exit FAILs, each later exit is BLOCKED 'earlier exit <x> failed'; a clean row is untouched", () => {
  const fq43 = row("FQ-43");
  const runs = expandExits(fq43);
  assert.ok(runs.length >= 3);
  const runResults = [];
  const pass = runResult({ label: runs[0].label, assertions: [{ name: "a", ok: true }] });
  runResults.push(pass);
  assert.equal(blockedAfterFailure(runs[1], runResults), null, "a PASS before it: the next exit runs");
  const fail = runResult({ label: runs[1].label, assertions: [productFail] });
  runResults.push(fail);
  for (const run of runs.slice(2)) {
    const skipped = blockedAfterFailure(run, runResults);
    assert.deepEqual([skipped.result, skipped.label, skipped.blocker], ["BLOCKED", run.label, `earlier exit ${runs[1].label} failed`]);
    runResults.push(skipped);
  }
  const result = caseResult(fq43, runResults);
  assert.equal(result.result, "FAIL", "the failed exit still decides the row");
  assert.equal(result.exits.filter((e) => e.result === "BLOCKED").length, runs.length - 2);
  assert.match(result.blocker, /earlier exit .* failed/);
});

test("N-1: a complete PASS stays PASS, and a BLOCKED exit alone does not stop the row", () => {
  const fq40 = row("FQ-40");
  const runs = expandExits(fq40);
  const passes = runs.map((run) => runResult({ label: run.label, assertions: [{ name: "a", ok: true }] }));
  assert.equal(caseResult(fq40, passes).result, "PASS");
  assert.equal(blockedAfterFailure(runs[1], [runResult({ label: runs[0].label, blocker: "no driver" })]), null);
});
