// FIX-17 (UNI-1380 G7-03a, Advisor qa-fault_local:46): FQ-50's per-exit tags and FQ-51's
// client_path reading.
//
// FQ-50: the queue machine has no way out of `blocked` back to `queued` - `dispatch` only
// runs on a `queued` record (machine.ts:502-504) and a blocked record is left only by
// `abandon` ("Bỏ nháp…", machine.ts:617-625) - so the four exits that lift a real server
// condition are predicted FAIL OQ-F12 (owner g5-fork_main, a machine.ts fix), while the two
// exits whose upload meets the server's 403 `document_archived` stay OQ-F6 (owner G5-07 for
// the deleted-vs-archived code plus g5-fork_main for the client).
//
// FQ-51: the trace's `blocked` is the fork's test hook rendering the coordinator's
// signed-out lock (trace.ts:171) on a record that never left `queued`, so `client_path`
// reads that render as the lift point - and only that render (`statePath` /
// `isHookSignedOutLift` in app-cases-lib.mjs). A real machine `blocked`, `session_expired`
// included, still fails the assertion.
//
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fix17.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EXTRA_EXITS } from "./app-case-drivers-blocked.mjs";
import {
  HOOK_SIGNED_OUT_CODES, assertStatePath, blockedAfterFailure, expandExits, isHookSignedOutLift, matchStatePath,
  predictedFor, runResult,
} from "./app-cases-lib.mjs";
import { caseExpect } from "./case-expect.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const rows = loadFaultCases().cases;
const row = (id) => rows.find((r) => r.id === id);
/** The runs app-cases.mjs makes for a row: its exits, then the driver's extra exits. */
const runsOf = (r) => [...expandExits(r), ...(EXTRA_EXITS[r.id] ?? []).map((exit, i) => ({ index: (r.exits?.length ?? 0) + i + 1, label: exit.exit, exit }))];
const tagsOf = (id) => runsOf(row(id)).map((run) => predictedFor(row(id), run));
const matrix = readFileSync(join(FAULT_DIR, "../../../../docs/office/g5g6g7/fault/matrix.md"), "utf8");
const matrixRow = (id) => matrix.split(/\r?\n/).find((l) => l.startsWith(`| ${id} |`));

/** The whole §5 bullet of an open question, its indented continuation lines included. */
function openQuestion(name) {
  const lines = matrix.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`- **${name} —`));
  assert.ok(at >= 0, `matrix §5 has no ${name} paragraph`);
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length && /^\s{2}\S/.test(lines[i]); i += 1) out.push(lines[i]);
  return out.join("\n");
}

test("FQ-50's exits carry OQ-F12 on 1/4/5 and OQ-F6 on 2/3 (Advisor qa-fault_local:46)", () => {
  assert.deepEqual(tagsOf("FQ-50"), ["OQ-F12", "OQ-F6", "OQ-F6", "OQ-F12", "OQ-F12"]);
  assert.ok(row("FQ-50").exits.every((e) => typeof e.predicted === "string"), "every exit lists predicted in cases.json");
  // a multi-exit row is tagged per exit, never through a row note
  assert.doesNotMatch(row("FQ-50").notes, /predicted FAIL/);
  assert.match(row("FQ-50").notes, /OQ-F12/);
  assert.match(row("FQ-50").notes, /OQ-F6/);
});

test("the OQ-F12 exits are the ones that lift a real condition; the OQ-F6 ones meet the 403", () => {
  assert.deepEqual(row("FQ-50").exits.map((e) => e.exit), [
    "permission_revoked → queued",
    "document_deleted → queued",
    "document_archived → queued",
    "organization_suspended → queued",
    "member_deactivated → queued",
  ]);
  assert.deepEqual(row("FQ-50").exits.map((e) => e.predicted), ["OQ-F12", "OQ-F6", "OQ-F6", "OQ-F12", "OQ-F12"]);
});

test("FQ-51 gains no tag: the reading fix is what its session_expired exit needs (qa-fault_local:46)", () => {
  assert.deepEqual(tagsOf("FQ-51"), [null, null, null]);
  assert.ok(row("FQ-51").exits.every((e) => e.predicted === undefined), "FQ-51's exits stay unpredicted");
});

test("the matrix FQ-50 row and the OQ-F6 / OQ-F12 paragraphs name the tags and the decision id", () => {
  const line = matrixRow("FQ-50");
  assert.match(line, /OQ-F12/);
  assert.match(line, /OQ-F6/);
  assert.match(line, /qa-fault_local:46/);
  const oq6 = openQuestion("OQ-F6");
  assert.match(oq6, /`document_files\.go:130-133`/, "the upload route's preflight is cited");
  assert.match(oq6, /`document_commit\.go:216-221`/, "archivedSaveRefusal is cited");
  assert.match(oq6, /`errors\.ts:142`/, "the fork's 403 -> forbidden mapping is cited");
  assert.match(oq6, /`errors\.ts:152`/, "isTerminalRefusal is cited");
  assert.match(oq6, /G5-07.*g5-fork_main/s, "both owners are named");
  assert.match(oq6, /qa-fault_local:46/);
  const oq12 = openQuestion("OQ-F12");
  assert.match(oq12, /machine\.ts:617-625/, "blocked left only by abandon");
  assert.match(oq12, /machine\.ts:502-504/, "dispatch only from queued");
  assert.match(oq12, /g5-fork_main/);
  assert.match(oq12, /lối ra 1\/4\/5/);
  assert.match(oq12, /qa-fault_local:46/);
  // OQ-F12 sits next to OQ-F11 in the same list, after it
  assert.ok(matrix.indexOf("- **OQ-F12 —") > matrix.indexOf("- **OQ-F11 —"));
});

test("with every FQ-50 exit tagged, a FAIL on one exit never blocks the exits after it", () => {
  const fq50 = row("FQ-50");
  const results = [];
  const ran = [];
  for (const run of runsOf(fq50)) {
    const skipped = blockedAfterFailure(run, results);
    if (skipped) {
      results.push(skipped);
      continue;
    }
    ran.push(run.index);
    results.push(runResult({ label: run.label, assertions: [{ name: "client_path", ok: false }], predicted: predictedFor(fq50, run) }));
  }
  assert.deepEqual(ran, [1, 2, 3, 4, 5], "no exit is held back");
  assert.ok(results.every((r) => r.result === "FAIL" && ["OQ-F12", "OQ-F6"].includes(r.predicted)));
});

// ---- FQ-51: the hook's signed-out render read as the lift --------------------------------
const DOC = "01M50NZWJK33YJPYKF6BGSFCJH";
const INTENT = "office-intent-214c6021-6135-4582-a6d1-c53f8b0845ed";
/** One trace line as the fork writes it (`{ts, intentId, documentId, from, to, httpStatus?, code?}`). */
const line = (from, to, extra = {}) => ({ ts: "2026-10-15T21:03:28.681Z", intentId: INTENT, documentId: DOC, from, to, ...extra });

/** r13/r14's FQ-51 exit-1 trace, verbatim: the hook's render, then the record's own lift to `validating`. */
const R14_EXIT1 = [
  line(null, "queued"),
  line("queued", "blocked", { code: "session_expired" }),
  line("queued", "validating"),
  line("validating", "uploading"),
  line("uploading", "committing"),
  line("committing", "committed", { httpStatus: 200 }),
];

/** A REAL machine blocked: the record entered `blocked` (a persisted move), then a move out of it. */
const MACHINE_COMMIT_FAILURE = [
  line(null, "queued"),
  line("queued", "validating"),
  line("validating", "uploading"),
  line("uploading", "committing"),
  line("committing", "blocked", { code: "session_expired" }),
  line("blocked", "validating"),
  line("validating", "uploading"),
  line("uploading", "committing"),
  line("committing", "committed", { httpStatus: 200 }),
];

/** The machine's capability verdict: `commitFailed` with no cause (dispatcher.ts:326-327) writes the same line. */
const MACHINE_CAPABILITY_VERDICT = [
  line(null, "queued"),
  line("queued", "blocked", { code: "session_expired" }),
  line("blocked", "validating"),
  line("validating", "committing"),
  line("committing", "committed", { httpStatus: 200 }),
];

const fq51Expect = () => caseExpect(row("FQ-51"), row("FQ-51").exits[0]);

test("(a) the r13/r14 FQ-51 exit-1 shape passes client_path, expectation unchanged", () => {
  const check = assertStatePath("client_path", R14_EXIT1, fq51Expect().clientPath());
  assert.equal(check.ok, true, `${check.expected} -> ${check.actual}`);
  // the raw record path is the one that failed r13/r14: without the reading there is no
  // `queued` after `blocked`, and the record never entered `blocked` at all
  assert.ok(!matchStatePath(["queued", "blocked", "validating", "uploading", "committing", "committed"], fq51Expect().clientPath()));
});

test("(b) a real queue-machine blocked followed by validating still fails client_path", () => {
  for (const [name, lines] of [["commit failure", MACHINE_COMMIT_FAILURE], ["capability verdict", MACHINE_CAPABILITY_VERDICT]]) {
    const check = assertStatePath("client_path", lines, fq51Expect().clientPath());
    assert.equal(check.ok, false, `${name}: a real blocked is never the lift (${check.actual})`);
  }
  // the collision the Advisor named: the machine can write `code=session_expired` too
  assert.equal(MACHINE_CAPABILITY_VERDICT[1].code, "session_expired");
  assert.ok(MACHINE_CAPABILITY_VERDICT[1].httpStatus === undefined, "no cause, no status - the same line as the hook's");
});

test("only the hook's signed-out render is a lift: its own code AND the record staying put", () => {
  assert.deepEqual([...HOOK_SIGNED_OUT_CODES], ["session_expired", "not_signed_in", "wrong_deployment"]);
  for (const code of HOOK_SIGNED_OUT_CODES) {
    const lines = [line(null, "queued"), line("queued", "blocked", { code }), line("queued", "validating")];
    assert.equal(isHookSignedOutLift(lines, 1), true, `${code}: the hook's signed-out code renders as blocked`);
  }
  const noLift = [line(null, "queued"), line("queued", "blocked", { code: "session_expired" })];
  assert.equal(isHookSignedOutLift(noLift, 1), false, "a render with no lift after it is not read as one");
  const fq50 = [line(null, "queued"), line("queued", "blocked", { code: "permission_revoked", httpStatus: 403 }), line("queued", "validating")];
  assert.equal(isHookSignedOutLift(fq50, 1), false, "FQ-50's own blocked is not a signed-out render");
  assert.equal(isHookSignedOutLift(MACHINE_COMMIT_FAILURE, 4), false, "the machine's blocked moved the record");
  assert.equal(isHookSignedOutLift(MACHINE_CAPABILITY_VERDICT, 1), false, "same code, but the record entered blocked");
});

test("(c) FQ-50 and FQ-51 keep their expectations; the reading does not loosen FQ-50", () => {
  assert.deepEqual(row("FQ-50").expect.clientPath, ["*", "blocked", "queued", "*", "committed"]);
  assert.deepEqual(row("FQ-51").exits[0].expect.clientPath, row("FQ-50").expect.clientPath);
  // r13's FQ-50 exit-1 trace: the same hook render, a permission_revoked code and no lift
  const fq50R13 = [line(null, "queued"), line("queued", "blocked", { code: "permission_revoked", httpStatus: 403 })];
  const check = assertStatePath("client_path", fq50R13, row("FQ-50").expect.clientPath);
  assert.equal(check.ok, false, "FQ-50 stays FAIL: its lift never happens");
});

test("the matrix FQ-51 row and the §6 clientPath line name the hook-lift reading and the decision id", () => {
  const line51 = matrixRow("FQ-51");
  assert.match(line51, /trace\.ts:169-173/);
  assert.match(line51, /machine\.ts:502-504/);
  assert.match(line51, /qa-fault_local:46/);
  const clientPathRow = matrix.split(/\r?\n/).find((l) => l.startsWith("| `clientPath` |"));
  assert.match(clientPathRow, /trace\.ts:165-173/);
  assert.match(clientPathRow, /save-coordinator\.ts:697-700/);
  assert.match(clientPathRow, /qa-fault_local:46/);
});
