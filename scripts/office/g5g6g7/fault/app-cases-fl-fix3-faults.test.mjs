// G7-03b (UNI-1382) fix3: reviewer_be r4 G703-R4-1..3 (FL-06). Each test was RED on dd174e1de and is GREEN after the fix.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fl-fix3-faults.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OFFLINE_FAULT_DRIVERS } from "./app-case-drivers-offline-faults.mjs";
import { createWorld } from "./app-cases-fl-fakes.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

const FAULT_DIR = dirname(fileURLToPath(import.meta.url));

async function run(tweak = () => {}) {
  const world = createWorld("FL-06");
  try {
    tweak(world);
    const outcome = await OFFLINE_FAULT_DRIVERS["FL-06"](world.ctx);
    const byName = Object.fromEntries(outcome.assertions.map((a) => [a.name, a]));
    return { world, outcome, byName, failed: outcome.assertions.filter((a) => !a.ok).map((a) => a.name) };
  } finally {
    world.clean();
  }
}

/** window B's refuse-regrant rule answers with another status / body code (the proxy's `status` action shape) */
const answerWith = (patch) => (w) => {
  const setRules = w.ctx.setRules;
  w.ctx.setRules = async (list) => setRules(list.map((rule) => (rule.id === "refuse-regrant" ? { ...rule, action: { ...rule.action, ...patch } } : rule)));
};

test("G703-R4-1: a second revoke that fails AFTER window A already failed keeps window A's FAIL, not BLOCKED", async () => {
  const { outcome, failed } = await run((w) => {
    w.grantEpochOverride = 1;
    const revoke = w.ctx.revokeOfflineLeases;
    let calls = 0;
    w.ctx.revokeOfflineLeases = async () => {
      calls += 1;
      return calls === 2 ? { failure: "second CLI revoke unavailable", evidence: null } : revoke();
    };
  });
  assert.equal(outcome.blocker, undefined, "window A's observed FAIL is not discarded as a blocker");
  assert.ok(failed.includes("regrant_records_new_epoch"), failed.join(","));
});

test("G703-R4-1: a second revoke that fails after a CLEAN window A stays BLOCKED with its line", async () => {
  const { outcome } = await run((w) => {
    const revoke = w.ctx.revokeOfflineLeases;
    let calls = 0;
    w.ctx.revokeOfflineLeases = async () => {
      calls += 1;
      return calls === 2 ? { failure: "second CLI revoke unavailable", evidence: null } : revoke();
    };
  });
  assert.equal(outcome.blocker, "second CLI revoke unavailable");
});

test("G703-R4-2: window B answered 403 server_error is not the revoke - row_revoked and open_refused_permission_revoked FAIL", async () => {
  const { failed, outcome } = await run(answerWith({ body: { error: { code: "server_error", message: "boom", error_class: "server" } } }));
  assert.equal(outcome.blocker, undefined);
  assert.ok(failed.includes("row_revoked"), failed.join(","));
  assert.ok(failed.includes("open_refused_permission_revoked"), failed.join(","));
});

test("G703-R4-2: window B answered with another status (500) is not the revoke either", async () => {
  const { failed } = await run(answerWith({ code: 500 }));
  assert.ok(failed.includes("row_revoked"), failed.join(","));
  assert.ok(failed.includes("open_refused_permission_revoked"), failed.join(","));
});

test("G703-R4-2: window B answered 200 is a grant - no revoked row, s11_window_renew_refused FAILs", async () => {
  const { failed } = await run(answerWith({ code: 200, body: {} }));
  assert.ok(failed.includes("row_revoked"), failed.join(","));
  assert.ok(failed.includes("s11_window_renew_refused"), failed.join(","));
});

test("G703-R4-2 control: the configured 403 offline_lease_revoked still revokes the copy", async () => {
  const { failed, byName } = await run();
  assert.deepEqual(failed, []);
  assert.equal(byName.row_revoked.actual, "revoked");
});

test("G703-R4-3: window B is labelled an INJECTED refusal in the driver assertion, cases.json and matrix.md", async () => {
  const { byName } = await run();
  assert.match(byName.s11_window_renew_refused.expected, /INJECTED rule refuse-regrant/);
  const row = loadFaultCases().cases.find((r) => r.id === "FL-06");
  assert.match(row.faults[0].step, /TIÊM/);
  const matrix = readFileSync(join(FAULT_DIR, "../../../../docs/office/g5g6g7/fault/matrix.md"), "utf8");
  const line = matrix.split("\n").find((l) => l.startsWith("| FL-06 |"));
  assert.match(line, /TỪ CHỐI BỞI RULE TIÊM `refuse-regrant`/);
  assert.match(line, /Cửa sổ B là hành vi TIÊM ở proxy, không phải hành vi của D/);
  assert.doesNotMatch(line, /nơi `grant\(\)` không chạy được/, "the fork DOES call grant() in window B");
});
