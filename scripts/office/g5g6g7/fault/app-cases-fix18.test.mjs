// FIX-18 (UNI-1380 G7-03a, review r7 R7-1): FQ-51's signed-out observable.
//
// R7-1 (blocking): `signed_out_row_locked` demanded `lockedCount >= 1` on the sync center's
// signed-out summary - an observable a cleanly parked sign-out never produces. The summary
// counts the working-copy folders that SURVIVED the lock: the last owner's dirs whose binding
// is not `ready`/`saved` (`sync-center.ts:1184-1200` over `binding-store.ts:163-175,426-432`).
// G5-11's lock parks the intent into the encrypted store and deletes the plaintext folder and
// the account dir (`service.ts:2286-2328`), so a clean park reports 0 - the designed
// `uwSyncSignedOutEmpty` variant (EXPERIENCE :260, :841-842) - and r14 reported a correct
// product as FAIL (`signed_out/locked=0`, exits 2-3). The reading now pins the surface the
// `signed_out` reason rides on (status + a summary with an integer count) instead of a locked
// item the path never leaves, while an exit that truly expects a held item still FAILs a
// summary reporting none (the R7-1 guard: never drop the claim silently).
//
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fix18.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { signedOutFacts, signedOutSummaryReading } from "./app-session.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const driver = readFileSync(join(FAULT_DIR, "app-case-drivers-blocked.mjs"), "utf8");
const matrix = readFileSync(join(FAULT_DIR, "../../../../docs/office/g5g6g7/fault/matrix.md"), "utf8");
const matrixRow = (id) => matrix.split(/\r?\n/).find((l) => l.startsWith(`| ${id} |`));

/** The r14 shape: the app is signed out and its summary reports what it still holds (0). */
const CLEAN_PARK = { status: "signed_out", lockedCount: 0, error: null };
/** A residual dirty folder survived the lock: the product's own count is > 0. */
const RESIDUAL = { status: "signed_out", lockedCount: 2, error: null };
/** A snapshot whose summary (the locked "row" of the signed-out screen) is absent. */
const NO_SUMMARY = { status: "signed_out", lockedCount: null, error: null };
/** The probe could not read the sync center at all. */
const NO_PROBE = { status: null, lockedCount: null, error: "no uniworkSyncCenter.getSnapshot" };

test("the r14 shape (clean park, lockedCount 0) passes the reading the exits 2-3 use", () => {
  const row = signedOutSummaryReading(CLEAN_PARK);
  assert.equal(row.ok, true, `${row.expected} -> ${row.actual}`);
  assert.equal(row.actual, "signed_out/locked=0");
  // a legitimate residual item keeps passing: the reading pins the surface, not a number
  assert.equal(signedOutSummaryReading(RESIDUAL).ok, true);
});

test("a snapshot with no locked row still FAILs when the exit truly expects a held item", () => {
  // the R7-1 guard: the claim is only deferred to the exits that really make it
  assert.equal(signedOutSummaryReading(CLEAN_PARK, "locked-item").ok, false);
  assert.equal(signedOutSummaryReading(RESIDUAL, "locked-item").ok, true);
  const held = signedOutSummaryReading(CLEAN_PARK, "locked-item");
  assert.match(held.expected, />= 1 item locked on this device/);
});

test("a snapshot with no signed-out summary always FAILs: the surface must exist", () => {
  for (const expects of ["summary", "locked-item"]) {
    assert.equal(signedOutSummaryReading(NO_SUMMARY, expects).ok, false, `${expects}: no summary is no locked row`);
    assert.equal(signedOutSummaryReading(NO_PROBE, expects).ok, false, `${expects}: a missing probe is a FAIL`);
  }
  assert.equal(signedOutSummaryReading(NO_PROBE).actual, "no uniworkSyncCenter.getSnapshot/locked=-");
  // not signed out at all: the signed-out summary is not the surface yet
  for (const status of ["signed_in", "session_expired"]) {
    assert.equal(signedOutSummaryReading({ status, lockedCount: 3 }).ok, false, `${status} is not the signed-out state`);
  }
  // an unknown expectation throws rather than quietly dropping the claim
  assert.throws(() => signedOutSummaryReading(CLEAN_PARK, "maybe"), /unknown signed-out expectation/);
});

/** A session whose renderer is the shell page and answers `snapshot` from the sync center. */
function fakeSession(snapshot) {
  const inWindow = {
    uniworkSyncCenter: {
      getSnapshot: async () => snapshot,
    },
  };
  return {
    shell: {
      evaluate: async (fn) => {
        globalThis.window = inWindow;
        try {
          return await fn();
        } finally {
          delete globalThis.window;
        }
      },
    },
  };
}

test("the probe feeds the reading: a snapshot without signedOut is a FAIL, one with it is read", async () => {
  const snapshot = (signedOut) => ({ header: { status: "signed_out" }, ...(signedOut ? { signedOut } : {}), tabs: { attention: [], pending: [], recent: [] } });
  const without = await signedOutFacts(fakeSession(snapshot(null)));
  assert.deepEqual([without.status, without.lockedCount], ["signed_out", null]);
  assert.equal(signedOutSummaryReading(without).ok, false, "no summary = no locked row");
  const with2 = await signedOutFacts(fakeSession(snapshot({ lockedCount: 2 })));
  assert.deepEqual([with2.status, with2.lockedCount], ["signed_out", 2]);
  assert.equal(signedOutSummaryReading(with2).ok, true);
});

test("the FQ-51 driver reads the summary and never demands a locked item for this path", () => {
  assert.match(driver, /signedOutSummaryReading\(await signedOutFacts\(session\)\)/, "the driver reads the new surface");
  assert.match(driver, /assertion\("signed_out_row_locked", signedOutRow\.expected, signedOutRow\.actual, signedOutRow\.ok\)/);
  assert.doesNotMatch(driver, />= 1 locked item/, "the claim R7-1 removed is gone");
  assert.doesNotMatch(driver, /lockedCount >= 1/);
  // the row's lock stays pinned by the other assertions
  assert.match(driver, /signed_out_before_sign_in/);
  assert.match(driver, /no_dispatch_while_signed_out/);
});

test("the matrix FQ-51 row records the R7-1 reading and the fork citations it rests on", () => {
  const row = matrixRow("FQ-51");
  assert.ok(row, "the matrix has the FQ-51 row");
  assert.match(row, /R7-1/, "the review finding is named");
  assert.match(row, /sync-center\.ts:1184-1200/, "the field's builder is cited");
  assert.match(row, /service\.ts:2286-2328/, "the lock's plaintext deletion is cited");
  assert.match(row, /uwSyncSignedOutEmpty/, "the designed 0-count variant is named");
  // fix17's reading of the same row must survive this edit
  assert.match(row, /trace\.ts:169-173/);
  assert.match(row, /qa-fault_local:46/);
});
