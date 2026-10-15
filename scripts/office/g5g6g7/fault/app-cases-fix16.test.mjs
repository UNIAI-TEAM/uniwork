// FIX-16 (UNI-1380 G7-03a, round 13): the app rows that the G5-11 fork changed
// under the cases - FQ-53's store budget, FQ-51's confirmed sign-out, the
// deactivate/reactivate request shape - and the review r6 items.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fix16.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SYNC_STORE_BUDGET_BYTES, syncStoreScopeDir } from "./app-cases-lib.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const driver = readFileSync(join(FAULT_DIR, "app-case-drivers-blocked.mjs"), "utf8");

test("FQ-53's fill reaches the G5-11 store budget (1 GiB), not the G5-04 one (256 MiB)", () => {
  // fork 53ea00672 (G5-11) raised apps/shell/src/main/uniwork-docs/wiring.ts
  // SYNC_STORE_BUDGET_BYTES from 256 MiB to 1024 * 1024 * 1024; layer.ts:353
  // refuses a write once the scope's own bytes would pass it. r13 PASS->FAIL
  // came from the fill staying at the old 256 MiB.
  assert.equal(SYNC_STORE_BUDGET_BYTES, 1024 * 1024 * 1024);
  assert.equal(syncStoreScopeDir("/u", "default", "01JUSER"), join("/u", "uniwork-sync", "store", "default", "01JUSER"));
  assert.match(driver, /ftruncateSync\(fd, SYNC_STORE_BUDGET_BYTES\)/, "the filler is as large as the budget");
  assert.doesNotMatch(driver, /256 \* 1024 \* 1024/, "no stale G5-04 budget literal in the driver");
});
