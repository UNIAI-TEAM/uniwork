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
import { blockedAfterFailure, expandExits, predictedFor, runResult } from "./app-cases-lib.mjs";
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
