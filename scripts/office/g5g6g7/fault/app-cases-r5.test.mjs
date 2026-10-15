// FIX-11 (UNI-1380 G7-03a, Advisor qa-fault_local:23): per-exit predicted FAIL OQ-F11 on FQ-40 exits 2..5 and FQ-41..FQ-44.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-r5.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { EXTRA_EXITS } from "./app-case-drivers-blocked.mjs";
import { blockedAfterFailure, expandExits, predictedFor, runResult } from "./app-cases-lib.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const rows = loadFaultCases().cases;
const row = (id) => rows.find((r) => r.id === id);
/** The runs app-cases.mjs makes for a row: its exits, then the driver's extra exits. */
const runsOf = (r) => [...expandExits(r), ...(EXTRA_EXITS[r.id] ?? []).map((exit, i) => ({ index: (r.exits?.length ?? 0) + i + 1, label: exit.exit, exit }))];
const tagsOf = (id) => runsOf(row(id)).map((run) => predictedFor(row(id), run));

test("exactly these exits of FQ-40..FQ-44 carry OQ-F11: every run of every one of the five rows", () => {
  assert.deepEqual(tagsOf("FQ-40"), Array(5).fill("OQ-F11"));
  assert.deepEqual(tagsOf("FQ-41"), ["OQ-F11"]);
  assert.deepEqual(tagsOf("FQ-42"), ["OQ-F11"]);
  // FQ-43: six table exits + three real-condition runs; document_archived (exit 4) is OQ-F11, not OQ-F6
  assert.deepEqual(tagsOf("FQ-43"), Array(9).fill("OQ-F11"));
  assert.deepEqual(tagsOf("FQ-44"), Array(3).fill("OQ-F11"));
});

test("the OQ-F11 tag is the exit's own field, never a row note on a multi-exit row", () => {
  for (const id of ["FQ-40", "FQ-41", "FQ-42", "FQ-43", "FQ-44"]) {
    const r = row(id);
    assert.ok(r.exits.every((e) => e.predicted === "OQ-F11"), `${id}: every exit lists predicted in cases.json`);
    assert.ok(!/predicted FAIL/.test(r.notes ?? ""), `${id}: no row-level "predicted FAIL" note`);
  }
  assert.ok(EXTRA_EXITS["FQ-43"].every((e) => e.predicted === "OQ-F11"));
  const fq43 = row("FQ-43");
  assert.match(fq43.notes, /OQ-F6/, "FQ-43's note says OQ-F6 still applies once reconciling exists");
  assert.match(fq43.exits[3].exit, /document_archived/);
});

test("FQ-22 and FQ-24 tags are unchanged, FQ-50 carries its fix17 tags; no other row gains a tag", () => {
  assert.deepEqual(tagsOf("FQ-22"), ["OQ-F11"]);
  assert.deepEqual(tagsOf("FQ-24"), ["F4"]);
  // FIX-17 (Advisor qa-fault_local:46): the four condition-lift exits are OQ-F12
  // (the queue never moves blocked -> queued), the two server exits stay OQ-F6
  assert.deepEqual(tagsOf("FQ-50"), ["OQ-F12", "OQ-F6", "OQ-F6", "OQ-F12", "OQ-F12"]);
  const tagged = rows.filter((r) => r.layer === "app" && runsOf(r).some((run) => predictedFor(r, run))).map((r) => r.id);
  assert.deepEqual(tagged, ["FQ-22", "FQ-24", "FQ-40", "FQ-41", "FQ-42", "FQ-43", "FQ-44", "FQ-50"]);
});

test("a predicted FAIL on an earlier exit no longer blocks FQ-40's later exits or FQ-43's: every exit runs", () => {
  for (const id of ["FQ-40", "FQ-43", "FQ-44"]) {
    const results = [];
    const ran = [];
    for (const run of runsOf(row(id))) {
      const skipped = blockedAfterFailure(run, results);
      if (skipped) {
        results.push(skipped);
        continue;
      }
      ran.push(run.index);
      results.push(runResult({ label: run.label, assertions: [{ name: "client_path", ok: false }], predicted: predictedFor(row(id), run) }));
    }
    assert.equal(ran.length, runsOf(row(id)).length, `${id}: no exit was BLOCKED`);
    assert.ok(results.every((r) => r.result === "FAIL" && r.predicted === "OQ-F11"));
  }
});
